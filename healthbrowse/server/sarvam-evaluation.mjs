import {listSarvamModels,completeSarvam,SARVAM_FLASH_MODEL} from './sarvam-client.mjs';
import {DEEPSEEK_MODELS} from './model-provider.mjs';
import {prepareCited,prepareCitedReview,applyCitedReview,presentCited} from './model-cited.mjs';
import {quantitativeSupport} from './clinician-synthesis.mjs';
import {clinicalPromptVersion} from './clinical-prompt.mjs';
import {sarvamEvaluationFixtures} from './sarvam-evaluation-fixtures.mjs';

const MAX_CALLS=6,MAX_TOKENS=1600;
const errorCodes=new Set(['provider_access','provider_credits','provider_model_unavailable','provider_busy','provider_configuration','provider_unavailable',
 'provider_network_error','provider_timeout','request_cancelled','provider_output_invalid','provider_output_truncated','provider_output_unexpected',
 'provider_refusal','provider_model_mismatch','sarvam_key_missing','invalid_sarvam_input','provider_redirect','invalid_request']);
const usageKeys=['promptTokens','completionTokens','totalTokens','reasoningTokens','cachedTokens'];
const safeUsage=usage=>Object.fromEntries(usageKeys.filter(key=>Number.isSafeInteger(usage?.[key])&&usage[key]>=0).map(key=>[key,usage[key]]));
const aggregateUsage=calls=>{
 const used=calls.filter(call=>Object.keys(call.usage||{}).length);
 return {reportedCalls:used.length,...Object.fromEntries(usageKeys.filter(key=>used.some(call=>Number.isSafeInteger(call.usage[key])))
  .map(key=>[key,used.reduce((sum,call)=>sum+(call.usage[key]||0),0)]))};
};
const safeError=error=>({code:errorCodes.has(error?.code)?error.code:'evaluation_failed',
 ...(Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?{httpStatus:error.status}:{})});
const elapsed=start=>Math.max(0,Date.now()-start);
function withoutSecret(value,key){
 if(!key)return value;
 // No provider error bodies or raw model drafts enter the report. Redact the
 // credential defensively even if an upstream incorrectly echoes it in output.
 if(typeof value==='string')return value.split(key).join('[REDACTED]');
 if(Array.isArray(value))return value.map(item=>withoutSecret(item,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,item])=>[field,withoutSecret(item,key)]));
 return value;
}

function inspectAnswer(fixture,prepared,draft,check,approved,presented){
 const map=new Map(prepared.evidence.sources.map(source=>[source.id,source]));
 const blocks=presented.answer?.blocks||[];
 const reviewed=approved.answer.length>0||(approved.conflicts?.length||0)>0;
 const references=blocks.flatMap(block=>block.references||[]);
 const quotesMatch=references.length>0&&references.every(ref=>map.has(ref.id)&&typeof ref.quote==='string'&&map.get(ref.id).text.includes(ref.quote));
 const numericSupport=blocks.every(block=>quantitativeSupport(block.text,(block.references||[]).map(ref=>ref.quote)));
 const answerText=blocks.map(block=>block.text).join(' ');
 const fixtureChecks=fixture.expected.map(expectation=>{
  const matched=expectation.patterns.map(pattern=>new RegExp(pattern,'i').test(answerText));
  return {id:expectation.id,passed:expectation.match==='none'?!matched.some(Boolean):expectation.match==='all'?matched.every(Boolean):matched.some(Boolean)};
 });
 const checks={generationSchema:true,reviewSchema:true,allDraftClaimsEnteredReview:check.claims.length===draft.answer.length,
  reviewComplete:approved.supportReview==='completed',reviewedOutputPresent:reviewed,exactSourceQuotes:quotesMatch,numericSourceCheck:numericSupport,
  minimumSourceCoverage:new Set(references.map(ref=>ref.id)).size>=(fixture.minimumSources||1),fixtureChecks};
 const passed=Object.entries(checks).filter(([key])=>key!=='fixtureChecks').every(([,value])=>value===true)&&fixtureChecks.every(check=>check.passed);
 return {passed,checks,generatedClaims:draft.answer.length,acceptedClaims:approved.answer.length,withheldClaims:approved.withheldClaims||0,
  conflicts:approved.conflicts?.length||0,answer:blocks.map(block=>({section:block.section||'evidence',text:block.text,
   sources:(block.references||[]).map(ref=>({id:ref.id,quote:ref.quote,page:ref.page,title:ref.title}))}))};
}

// Environment-neutral so the same bounded suite can run in a CLI or a private
// staging endpoint. No user-supplied cases, automatic retries or provider fallback.
export async function runSarvamEvaluation({key,fetchImpl=fetch,runAlternative=false,signal,timeoutMs=30000}={}){
 const started=Date.now(),calls=[];
 const report={version:'sarvam-synthetic-cited-v2',clinicalPromptVersion,status:'not_run',syntheticOnly:true,clinicalValidation:false,
  note:'Mechanical source, schema and fixture checks only. This is not clinical accuracy validation, a medical benchmark or model certification.',
  alternativeModel:SARVAM_FLASH_MODEL,alternativeIsDifferentCheckpoint:true,catalogCalls:0,completionCalls:0,
  limits:{maxCompletionCalls:MAX_CALLS,maxOutputTokensPerCall:MAX_TOKENS,maxEvaluationMs:180000},
  checkpointInventory:Object.entries(DEEPSEEK_MODELS).map(([route,model])=>({route,model,listedForThisAccount:null,inferenceTested:false})),cases:[]};
 const finish=()=>withoutSecret({...report,completionCalls:calls.length,calls,usage:aggregateUsage(calls),elapsedMs:elapsed(started)},key);
 if(typeof key!=='string'||!key.trim()){report.reason='missing_sarvam_api_key';return finish()}
 if(key.length>8192||/\s/.test(key)){report.reason='invalid_sarvam_api_key';return finish()}
 const requestMs=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(Math.floor(timeoutMs),30000):30000;
 const deadline=AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])]);
 let catalog;
 try{
  deadline.throwIfAborted();report.catalogCalls=1;
  catalog=await listSarvamModels({apiKey:key,fetcher:fetchImpl,signal:deadline,timeoutMs:Math.min(requestMs,15000)});
 }catch(error){report.status='failed';report.error=safeError(error);return finish()}
 const models=catalog.models;
 report.checkpointInventory=report.checkpointInventory.map(row=>({...row,listedForThisAccount:models.some(model=>model.id===row.model)}));
 report.allCurrentCheckpointsListed=report.checkpointInventory.every(row=>row.listedForThisAccount);
 const alternative=models.find(model=>model.id===SARVAM_FLASH_MODEL);
 report.alternativeAvailability={listedForThisAccount:!!alternative,access:alternative?.access||'unspecified'};
 report.modelComparison='Catalog matching uses exact checkpoint IDs. The alternative is not an alias or equivalent checkpoint for the existing R1 distill or V3.2 models.';
 if(runAlternative!==true){report.status='catalog_only';report.reason='alternative_evaluation_not_requested';return finish()}
 if(!alternative){report.status='not_run';report.reason='alternative_model_not_listed';return finish()}
 if(alternative.access==='provisioned'){report.status='not_run';report.reason='provisioned_model_not_enabled_by_harness';return finish()}
 const invoke=async(phase,messages,schema)=>{
  if(calls.length>=MAX_CALLS)throw Object.assign(new Error(),{code:'invalid_request'});
  deadline.throwIfAborted();
  const start=Date.now(),metric={phase,requestedModel:SARVAM_FLASH_MODEL,status:'started'};calls.push(metric);
  try{
   const result=await completeSarvam({apiKey:key,model:SARVAM_FLASH_MODEL,messages,schema,maxTokens:MAX_TOKENS,
    reasoningEffort:'none',fetcher:fetchImpl,signal:deadline,timeoutMs:requestMs});
   Object.assign(metric,{status:'completed',reportedModel:result.model,usage:safeUsage(result.usage),elapsedMs:elapsed(start),schemaValidated:true});
   return result;
  }catch(error){Object.assign(metric,{status:'failed',error:safeError(error),usage:safeUsage(error?.usage),elapsedMs:elapsed(start),schemaValidated:false});throw error}
 };
 for(const fixture of sarvamEvaluationFixtures){
  const start=Date.now(),firstCall=calls.length;
  const record={id:fixture.id,title:fixture.title,status:'not_run',requestedModel:SARVAM_FLASH_MODEL,syntheticOnly:true,
   question:fixture.input.question,suppliedSources:fixture.sources.map(({id,title,text,page,sourceType})=>({id,title,text,page,sourceType}))};
  report.cases.push(record);
  try{
   const input=structuredClone(fixture.input),evidence={documentMode:true,clinicalDocument:true,domains:[],style:'Synthetic clinician fixture',sources:structuredClone(fixture.sources)};
   const prepared=prepareCited(input,evidence);
   prepared.schema.properties.answer.maxItems=3;
   prepared.messages[0].content+=' This is a synthetic software evaluation, not patient care. Return at most three claims. Do not add outside medical recommendations.';
   const generated=await invoke('generation',prepared.messages,prepared.schema);
   record.reportedModel=generated.model;
   const check=prepareCitedReview(generated.value,prepared,input);
   if(!check.claims.length){record.status='failed_mechanical_checks';record.checks={generationSchema:true,reviewedOutputPresent:false};record.reason='no_reviewable_claims';continue}
   const reviewed=await invoke('support_review',check.messages,check.schema);
   record.reviewModel=reviewed.model;
   const approved=applyCitedReview(reviewed.value,check,prepared,input);
   const presented=presentCited(approved,prepared,input,SARVAM_FLASH_MODEL);
   const inspection=inspectAnswer(fixture,prepared,generated.value,check,approved,presented);
   Object.assign(record,inspection,{status:inspection.passed?'passed_mechanical_checks':'failed_mechanical_checks'});
  }catch(error){record.status='failed';record.error=safeError(error);report.error=safeError(error);report.reason='stopped_without_retry';break}
  finally{record.elapsedMs=elapsed(start);record.usage=aggregateUsage(calls.slice(firstCall))}
 }
 for(const fixture of sarvamEvaluationFixtures.slice(report.cases.length))report.cases.push({id:fixture.id,title:fixture.title,status:'not_run',reason:'earlier_failure',requestedModel:SARVAM_FLASH_MODEL,elapsedMs:0});
 report.status=report.cases.length===sarvamEvaluationFixtures.length&&report.cases.every(record=>record.status==='passed_mechanical_checks')?'passed_mechanical_checks':'failed';
 return finish();
}
