import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runSarvamEvaluation} from '../server/sarvam-evaluation.mjs';
import {SARVAM_API_BASE,SARVAM_FLASH_MODEL} from '../server/sarvam-client.mjs';
import {DEEPSEEK_MODELS} from '../server/model-provider.mjs';
import {clinicalPromptVersion} from '../server/clinical-prompt.mjs';

const key='synthetic-key-never-log';
const catalog=(extra=[])=>Response.json({object:'list',data:[{id:SARVAM_FLASH_MODEL,access:'standard',owned_by:'deepseek'},...extra]});
const completion=value=>Response.json({model:SARVAM_FLASH_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],
 usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,completion_tokens_details:{reasoning_tokens:5}}});
function generated(payload){
 if(payload.question.includes('Cohort Cedar'))return {answer:[
  {text:'Cohort Cedar included 20 adult volunteers, and 12 completed the scheduled assessment.',sources:['D1'],section:'synthesis'},
  {text:'The report made no treatment comparison and does not establish treatment efficacy.',sources:['D1'],section:'limitations'}]};
 if(payload.question.includes('bleeding history'))return {answer:[
  {text:'No prior bleeding is documented.',sources:['D1'],section:'synthesis'},
  {text:'Portal vein thrombosis is suspected but has not been confirmed.',sources:['D1'],section:'evidence'},
  {text:'The reported onset is unknown.',sources:['D1'],section:'limitations'}]};
 return {answer:[{text:'The synthetic reports disagree about whether the monitoring signal increased in the same population and observation period.',sources:['D1','D2'],section:'limitations'}]};
}
function reviewed(payload){return {checks:payload.claims.map(claim=>({id:claim.id,verdict:'supported',sources:claim.sources,
 quotes:claim.sources.map(id=>payload.sources.find(source=>source.id===id).text)}))}}
function successfulFetcher(calls,{badNumbers=false,bleedingClaim,extraCatalog=[]}={}){
 return async(url,options)=>{
  calls.push({url,options});
  if(url===SARVAM_API_BASE+'/models')return catalog(extraCatalog);
  assert.equal(url,SARVAM_API_BASE+'/chat/completions');
  const body=JSON.parse(options.body),payload=JSON.parse(body.messages.find(message=>message.role==='user').content);
  assert.equal(body.model,SARVAM_FLASH_MODEL);assert.equal(body.max_tokens,1600);assert.equal(body.reasoning_effort,'none');
  assert.equal(options.headers['api-subscription-key'],key);
  assert.equal(body.messages.some(message=>message.content.includes(key)),false);
  if(payload.claims)return completion(reviewed(payload));
  if(badNumbers)return completion({answer:[{text:'The report states that 99 volunteers completed the assessment.',sources:['D1'],section:'synthesis'}]});
  const answer=generated(payload);
  if(bleedingClaim&&payload.question.includes('bleeding history'))answer.answer[0].text=bleedingClaim;
  return completion(answer);
 };
}

test('missing or invalid key is not a success and produces zero network calls',async()=>{
 let calls=0;
 for(const invalid of [undefined,'','   ','invalid key']){
  const report=await runSarvamEvaluation({key:invalid,runAlternative:true,fetchImpl:async()=>{calls++;throw Error('must not run')}});
  assert.equal(report.status,'not_run');assert.equal(report.completionCalls,0);assert.equal(report.catalogCalls,0);
 }
 assert.equal(calls,0);
});

test('default is catalog-only and compares the exact three current checkpoints without aliases',async()=>{
 const calls=[];
 const report=await runSarvamEvaluation({key,fetchImpl:successfulFetcher(calls,{extraCatalog:[{id:DEEPSEEK_MODELS.general}]})});
 assert.equal(report.status,'catalog_only');assert.equal(calls.length,1);assert.equal(report.completionCalls,0);
 assert.deepEqual(report.checkpointInventory.map(row=>row.model),Object.values(DEEPSEEK_MODELS));
 assert.deepEqual(report.checkpointInventory.map(row=>row.listedForThisAccount),[true,false,false]);
 assert(report.checkpointInventory.every(row=>row.inferenceTested===false));
 assert.equal(report.alternativeIsDifferentCheckpoint,true);assert.equal(report.allCurrentCheckpointsListed,false);
});

test('opt-in runs three fixed synthetic cases through real cited generation/review checks in six calls',async()=>{
 const calls=[];
 const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:successfulFetcher(calls)});
 assert.equal(report.status,'passed_mechanical_checks',JSON.stringify(report.cases));
 assert.equal(report.version,'sarvam-synthetic-cited-v2');assert.equal(report.clinicalPromptVersion,clinicalPromptVersion);
 assert.equal(report.clinicalValidation,false);assert.equal(report.syntheticOnly,true);
 assert.equal(report.completionCalls,6);assert.equal(report.catalogCalls,1);assert.equal(calls.length,7);
 assert.equal(report.cases.length,3);assert(report.cases.every(row=>row.status==='passed_mechanical_checks'));
 assert(report.cases.every(row=>row.requestedModel===SARVAM_FLASH_MODEL&&row.reportedModel===SARVAM_FLASH_MODEL));
 assert(report.cases.every(row=>row.checks.exactSourceQuotes&&row.checks.reviewComplete&&row.checks.numericSourceCheck));
 assert(report.cases.every(row=>row.suppliedSources.every(source=>source.sourceType.includes('Synthetic'))));
 assert.equal(report.usage.totalTokens,900);assert.equal(report.usage.reasoningTokens,30);
 assert(!JSON.stringify(report).includes(key));
});

test('an invented numerical claim is withheld even when the model reviewer labels it supported',async()=>{
 const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:successfulFetcher([],{badNumbers:true})});
 assert.equal(report.status,'failed');assert.equal(report.completionCalls,6);
 assert(report.cases.every(row=>row.acceptedClaims===0&&row.checks.reviewedOutputPresent===false));
 assert(report.cases.every(row=>row.status==='failed_mechanical_checks'));
 assert(!JSON.stringify(report.cases.map(row=>row.answer)).includes('99 volunteers'));
});

test('observed documentation-to-negative-history wording fails this fixture even when the reviewer accepts its exact quote',async()=>{
 const bleedingClaim='The supplied synthetic report documents no prior bleeding history, stating that no prior bleeding is documented.';
 const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:successfulFetcher([],{bleedingClaim})});
 const result=report.cases.find(row=>row.id==='negation-uncertainty');
 assert.equal(report.status,'failed');assert.equal(report.completionCalls,6);
 assert.equal(result.status,'failed_mechanical_checks');
 assert.equal(result.acceptedClaims,3);assert.equal(result.checks.exactSourceQuotes,true);
 assert.deepEqual(result.checks.fixtureChecks.filter(check=>!check.passed),[{id:'documentation_not_negative_history',passed:false}]);
 assert(report.cases.filter(row=>row.id!==result.id).every(row=>row.status==='passed_mechanical_checks'));
});

test('preserving undocumented history passes the fixture without treating it as a confirmed negative',async()=>{
 for(const bleedingClaim of ['No prior bleeding is documented.','No prior bleeding history is documented in the supplied report.']){
  const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:successfulFetcher([],{bleedingClaim})});
  const result=report.cases.find(row=>row.id==='negation-uncertainty');
  assert.equal(report.status,'passed_mechanical_checks');
  assert.equal(result.checks.fixtureChecks.find(check=>check.id==='documentation_not_negative_history').passed,true);
 }
});

test('unlisted and explicitly provisioned alternatives are never substituted or invoked',async()=>{
 for(const models of [[],[{id:SARVAM_FLASH_MODEL,access:'provisioned'}]]){
  let count=0;
  const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:async url=>{
   count++;assert.equal(url,SARVAM_API_BASE+'/models');return Response.json({data:models});
  }});
  assert.equal(report.status,'not_run');assert.equal(count,1);assert.equal(report.completionCalls,0);
 }
});

test('401 and 402 stop without retry or leaking upstream error text',async()=>{
 for(const status of [401,402]){
  let requests=0;
  const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:async url=>{
   requests++;return url===SARVAM_API_BASE+'/models'?catalog():Response.json({message:'SECRET '+key+' private upstream detail'},{status});
  }});
  assert.equal(report.status,'failed');assert.equal(report.completionCalls,1);assert.equal(requests,2);
  assert.equal(report.cases[0].error.httpStatus,status);
  assert.equal(report.cases[0].error.code,status===401?'provider_access':'provider_credits');
  assert(report.cases.slice(1).every(row=>row.status==='not_run'));
  assert(!JSON.stringify(report).includes('private upstream detail'));assert(!JSON.stringify(report).includes(key));
 }
});

test('model identity mismatch fails and keeps safe usage without retrying',async()=>{
 let count=0;
 const report=await runSarvamEvaluation({key,runAlternative:true,fetchImpl:async url=>{
  count++;if(url===SARVAM_API_BASE+'/models')return catalog();
  return Response.json({model:'different-model',choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{total_tokens:15}});
 }});
 assert.equal(report.status,'failed');assert.equal(count,2);assert.equal(report.completionCalls,1);
 assert.equal(report.error.code,'provider_model_mismatch');assert.equal(report.usage.totalTokens,15);
});

test('CLI help explains credits and different checkpoint; missing-key invocation writes not-run report',t=>{
 const script=new URL('../scripts/test-sarvam.mjs',import.meta.url);
 const help=spawnSync(process.execPath,[script.pathname,'--help'],{encoding:'utf8',env:{...process.env,SARVAM_API_KEY:''}});
 assert.equal(help.status,0);assert.match(help.stdout,/DIFFERENT model/);assert.match(help.stdout,/may consume API credits/);
 const temp=mkdtempSync(join(tmpdir(),'hb-sarvam-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const output=join(temp,'report.json');
 const result=spawnSync(process.execPath,[script.pathname,'--run-alternative','--out='+output],{encoding:'utf8',env:{...process.env,SARVAM_API_KEY:''}});
 assert.equal(result.status,1);
 const report=JSON.parse(readFileSync(output,'utf8'));assert.equal(report.status,'not_run');assert.equal(report.completionCalls,0);assert.equal(report.catalogCalls,0);
});
