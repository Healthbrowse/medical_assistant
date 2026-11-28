import {browserModelRoutes,buddyModelRoutes,buddyEndpoint,modelEndpoint,modelReviewEndpoint,
 fallbackEndpoint,deepseekModelId,HF_CHAT_URL,GROQ_CHAT_URL,sarvamProtocol} from './model-provider.mjs';
import {workersModels,workersProtocol,runWorkersCompletion} from './workers-ai.mjs';
import {completeSarvam,SarvamError,SARVAM_API_BASE} from './sarvam-client.mjs';
import {readDeepSeekResult,deepseekPayload,CompletionError} from './deepseek-client.mjs';
import {abortable} from '../dist/request-deadline.js';
import {isModelDisabled} from './model-policy.mjs';

// A connectivity/format audit, not a clinical evaluation. No caller-supplied
// prompt, patient case, URL or credential is ever included in the report.
export const modelAuditLimits=Object.freeze({maxRequests:12,maxOutputTokens:512,timeoutMs:15000,maxTimeoutMs:30000});
const schema={type:'object',properties:{status:{type:'string',enum:['ok']},total:{type:'integer',enum:[5]}},
 required:['status','total'],additionalProperties:false};
const messages=[{role:'system',content:'This is a fixed synthetic application connectivity check. Return only JSON matching '+JSON.stringify(schema)+'. Do not invoke tools or external resources.'},
 {role:'user',content:'Set status to ok and total to the sum of 2 and 3.'}];
const hfCatalogURL='https://router.huggingface.co/v1/models';
const validKey=key=>typeof key==='string'&&!!key&&key.length<=8192&&!/\s/.test(key);
const elapsed=start=>Math.max(0,Math.round(performance.now()-start));
class AuditError extends Error{constructor(code,status,providerCode){super(code);this.code=code;this.status=status;this.providerCode=providerCode}}

function transport(config){
 if(config.protocol===workersProtocol)return 'workers-ai';
 if(config.protocol==='deepseek-cited-v1'&&config.url===HF_CHAT_URL)return 'huggingface';
 if(config.protocol==='groq-cited-v1'&&config.url===GROQ_CHAT_URL)return 'groq';
 if(config.protocol===sarvamProtocol&&config.url===SARVAM_API_BASE+'/chat/completions')return 'sarvam';
 return 'unsupported';
}
function inventory(env){
 const targets=new Map();
 function add(config,purpose){
  if(!config)return;
  const provider=transport(config),id=JSON.stringify([provider,config.url||'native-binding',config.model]);
  let target=targets.get(id);
  if(!target){target={config,provider,purposes:new Set()};targets.set(id,target)}
  else if(config.key!==target.config.key)target.credentialConflict=true;
  target.purposes.add(purpose);
 }
 for(const config of browserModelRoutes(env).values())add(config,'browser_choice');
 const choices=new Set();
 for(const role of ['general','professional']){
  for(const [choice,config] of buddyModelRoutes(env,role)){choices.add(choice);add(config,'buddy:'+choice+':'+role)}
  add(modelEndpoint(env,role),'default:'+role);
  add(modelReviewEndpoint(env,role),'reviewer:'+role);
 }
 add(modelEndpoint(env,'agent'),'planner:default');
 for(const choice of choices)add(buddyEndpoint(env,choice,'agent'),'planner:'+choice);
 add(fallbackEndpoint(env),'configured_backup');
 // process.env cannot carry a Cloudflare AI binding. Its absence in a local
 // CLI does not demonstrate that the deployed Workers models have failed.
 if(env.MODEL_PROVIDER==='workers-ai'&&typeof env.AI?.run!=='function'){
  for(const role of ['general','professional','agent']){
   if(isModelDisabled(env,workersModels[role]))continue;
   const config={model:workersModels[role],protocol:workersProtocol};
   add(config,role==='agent'?'planner:default':'default:'+role);
   if(role!=='agent')add(config,'reviewer:'+role);
  }
 }
 return [...targets.values()];
}
function describe(target){
 return {provider:target.provider,model:target.provider==='unsupported'?null:target.config.model,
  purposes:[...target.purposes].sort()};
}
export function modelAuditInventory(env={}){return inventory(env).map(describe)}

function usageOf(data){
 const usage=data?.usage||{},result={};
 for(const [name,value] of Object.entries({promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,
  totalTokens:usage.total_tokens,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens,
  cachedTokens:usage.prompt_tokens_details?.cached_tokens})){
  if(Number.isSafeInteger(value)&&value>=0)result[name]=value;
 }
 return result;
}
function cancel(response){try{void response?.body?.cancel()?.catch(()=>{})}catch{}}
async function boundedJSON(response,signal,maxBytes=96000){
 if(!response?.body?.getReader)throw new AuditError('invalid_output');
 if(Number(response.headers?.get('content-length'))>maxBytes){cancel(response);throw new AuditError('response_too_large')}
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{
  while(true){
   const {done,value}=await abortable(reader.read(),signal);if(done)break;
   bytes+=value.byteLength;
   if(bytes>maxBytes){void reader.cancel().catch(()=>{});throw new AuditError('response_too_large')}
   text+=decoder.decode(value,{stream:true});
  }
  try{return JSON.parse(text+decoder.decode())}catch{throw new AuditError('invalid_output')}
 }finally{reader.releaseLock()}
}
function providerCodeOf(data){
 const code=data?.errors?.[0]?.code??data?.error?.code;
 return Number.isSafeInteger(code)&&code>=0&&code<=99999?code:undefined;
}
function httpError(status,providerCode){
 let code='provider_unavailable';
 if(status>=300&&status<400)code='redirect_blocked';
 else if(status===401)code='authentication_error';
 else if(status===403)code='access_denied';
 else if(status===402)code='credits_exhausted';
 else if(status===404)code='model_unavailable';
 // A generic 410 can identify a removed URL. Cloudflare's explicit 5028
 // below, rather than the status alone, establishes model retirement.
 else if(status===410)code='endpoint_gone';
 else if(status===429)code='rate_limited';
 else if(status===408||status===504)code='timeout';
 else if(status===413)code='request_too_large';
 else if([400,405,422].includes(status))code='configuration_error';
 if(providerCode===5028)code='model_retired';
 if(providerCode===5035)code='paid_plan_required';
 if(providerCode===3036)code='quota_exhausted';
 if(providerCode===3040)code='capacity_unavailable';
 return new AuditError(code,status,providerCode);
}
function safeFailure(error){
 const mapped={provider_access:'access_denied',provider_credits:'credits_exhausted',provider_model_unavailable:'model_unavailable',
  provider_busy:'rate_limited',provider_configuration:'configuration_error',provider_redirect:'redirect_blocked',
  provider_unavailable:'provider_unavailable',provider_network_error:'network_error',provider_timeout:'timeout',
  request_cancelled:'cancelled',sarvam_key_missing:'invalid_credentials',invalid_sarvam_input:'configuration_error',
  provider_model_mismatch:'model_mismatch',provider_refusal:'refused',provider_output_truncated:'output_truncated',
  provider_output_invalid:'invalid_output',provider_output_unexpected:'unexpected_output'};
 const auditCodes=new Set(['provider_unavailable','redirect_blocked','authentication_error','access_denied','credits_exhausted',
  'model_unavailable','endpoint_gone','model_retired','rate_limited','timeout','request_too_large','configuration_error','paid_plan_required',
  'quota_exhausted','capacity_unavailable','invalid_output','response_too_large','unexpected_output','model_mismatch']);
 const trusted=error instanceof AuditError||error instanceof CompletionError||error instanceof SarvamError;
 const usage={};
 if(error instanceof SarvamError)for(const name of ['promptTokens','completionTokens','totalTokens','reasoningTokens','cachedTokens']){
  const value=error.usage?.[name];if(Number.isSafeInteger(value)&&value>=0)usage[name]=value;
 }
 const code=error instanceof SarvamError&&Number.isInteger(error.status)?httpError(error.status).code:
  error instanceof AuditError&&auditCodes.has(error.code)?error.code:trusted?mapped[error.code]||'provider_unavailable':'network_error';
 return {code,
  ...(trusted&&Number.isInteger(error.status)&&error.status>=100&&error.status<=599?{httpStatus:error.status}:{}),
  ...(error instanceof AuditError&&Number.isInteger(error.providerCode)?{providerCode:error.providerCode}:{}),
  ...(Object.keys(usage).length?{usage}:{})};
}
function validateOptions({live,hfCatalogOnly,fetchImpl,maxRequests,timeoutMs}){
 if(typeof live!=='boolean'||typeof hfCatalogOnly!=='boolean'||typeof fetchImpl!=='function'||
  !Number.isInteger(maxRequests)||maxRequests<1||maxRequests>modelAuditLimits.maxRequests||
  !Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>modelAuditLimits.maxTimeoutMs)throw new AuditError('invalid_audit_options');
}
function deadline(signal,timeoutMs){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 return {signal:controller.signal,close(){clearTimeout(timer);signal?.removeEventListener('abort',abort)}};
}

async function probe(target,{fetchImpl,signal,timeoutMs},record){
 const {config,provider}=target;
 if(provider==='sarvam'){
  const result=await completeSarvam({apiKey:config.key,model:config.model,messages,schema,
   maxTokens:modelAuditLimits.maxOutputTokens,reasoningEffort:'none',fetcher:fetchImpl,signal,timeoutMs});
  record.reportedModel=result.model;record.modelIdentity='exact_reported_id';record.usage=result.usage;
  return;
 }
 let response;
 if(provider==='workers-ai')response=await abortable(Promise.resolve().then(()=>runWorkersCompletion(config,messages,modelAuditLimits.maxOutputTokens,schema,signal)),signal);
 else{
  const body=provider==='huggingface'?deepseekPayload(config.model,messages,modelAuditLimits.maxOutputTokens,schema):
   {model:config.model,messages,temperature:0,max_completion_tokens:modelAuditLimits.maxOutputTokens,stream:false,
    reasoning_effort:'low',include_reasoning:false,response_format:{type:'json_schema',json_schema:{name:'healthbrowse_audit',strict:true,schema}}};
  response=await abortable(Promise.resolve().then(()=>fetchImpl(config.url,{method:'POST',redirect:'manual',cache:'no-store',signal,
   headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)})),signal);
 }
 let data;
 if(response&&typeof response.ok==='boolean'&&Number.isInteger(response.status)){
  record.httpStatus=response.status;
  if(!response.ok){
   let providerCode;
   if(provider==='workers-ai')try{providerCode=providerCodeOf(await boundedJSON(response,signal,10000))}catch{}
   else cancel(response);
   throw httpError(response.status,providerCode);
  }
  data=await boundedJSON(response,signal);
 }else if(provider==='workers-ai'&&response&&typeof response==='object')data=response;
 else throw new AuditError('invalid_output');
 if(provider==='workers-ai'&&data?.success===false)throw httpError(record.httpStatus,providerCodeOf(data));
 if(provider==='workers-ai'&&data?.result&&typeof data.result==='object')data=data.result;
 record.usage=usageOf(data);
 const native=provider==='workers-ai'&&data&&!Object.hasOwn(data,'choices')&&Object.hasOwn(data,'response');
 // Exact ID comparison deliberately does not inherit the permissive HF alias
 // parser. A legitimate router alias is reported as mismatch, never retirement.
 if(data?.model!==config.model&&(!native||data?.model!==undefined)){
  record.modelIdentity=typeof data?.model==='string'?'reported_id_mismatch':'reported_id_missing';
  throw new AuditError('model_mismatch');
 }
 record.reportedModel=data.model===config.model?config.model:null;
 record.modelIdentity=native&&data.model===undefined?'pinned_native_binding':'exact_reported_id';
 if(!native){
  const choice=data?.choices?.[0];
  if(!Array.isArray(data?.choices)||data.choices.length!==1||!choice?.finish_reason||choice.message?.tool_calls?.length)throw new AuditError('unexpected_output');
 }
 if(typeof data?.response==='string'&&data.response.length>96000)throw new AuditError('response_too_large');
 readDeepSeekResult(data,config.model,schema);
}

async function catalogAudit({env,live,fetchImpl,signal,timeoutMs}){
 // Catalog review must retain disabled candidates so an operator can assess
 // re-enabling them. Only this read-only catalog path clears operator policy.
 const catalogEnv={...env,MODEL_DISABLED_MODELS:''};
 const models=[...new Set(['general','professional','agent'].map(role=>deepseekModelId(catalogEnv,role)).filter(Boolean))];
 const metadata=model=>({provider:'huggingface',model,operatorDisabled:isModelDisabled(env,model),retirementEstablished:false});
 const report={version:'healthbrowse-model-audit-v1',checkedAt:new Date().toISOString(),mode:'hf_catalog',clinicalValidation:false,inferenceTested:false,
  status:live?'not_run':'dry_run',requests:0,results:models.map(model=>({...metadata(model),status:'not_run'}))};
 if(!live)return report;
 if(signal?.aborted){report.code='cancelled';return report}
 if(env.HF_TOKEN!==undefined&&!validKey(env.HF_TOKEN)){report.code='invalid_credentials';return report}
 const timer=deadline(signal,timeoutMs),start=performance.now();
 try{
  report.requests=1;
  const response=await abortable(Promise.resolve().then(()=>fetchImpl(hfCatalogURL,{method:'GET',redirect:'manual',cache:'no-store',signal:timer.signal,
   headers:{Accept:'application/json',...(env.HF_TOKEN?{Authorization:'Bearer '+env.HF_TOKEN}:{})}})),timer.signal);
  if(!response?.ok){cancel(response);throw httpError(response?.status)}
  const data=await boundedJSON(response,timer.signal,1000000);
  if(!Array.isArray(data?.data)||data.data.length>5000)throw new AuditError('invalid_output');
  report.results=models.map(model=>{
   const item=data.data.find(entry=>entry?.id===model),providers=Array.isArray(item?.providers)?item.providers:[];
   return {...metadata(model),status:item?'catalog_listed':'catalog_unlisted',providerCount:providers.length,
    liveProviders:providers.filter(entry=>entry?.status==='live').length,
    structuredOutputProviders:providers.filter(entry=>entry?.status==='live'&&entry?.supports_structured_output===true).length};
  });
  report.status='catalog_only';
 }catch(error){
  report.status='failed';Object.assign(report,timer.signal.aborted?{code:signal?.aborted?'cancelled':'timeout'}:safeFailure(error));
 }finally{timer.close();report.elapsedMs=elapsed(start)}
 return report;
}

export async function runModelAudit({env={},live=false,hfCatalogOnly=false,fetchImpl=fetch,signal,
 maxRequests=modelAuditLimits.maxRequests,timeoutMs=modelAuditLimits.timeoutMs}={}){
 validateOptions({live,hfCatalogOnly,fetchImpl,maxRequests,timeoutMs});
 if(hfCatalogOnly)return catalogAudit({env,live,fetchImpl,signal,timeoutMs});
 const targets=inventory(env),report={version:'healthbrowse-model-audit-v1',checkedAt:new Date().toISOString(),mode:'inference',clinicalValidation:false,
  status:live?'not_run':'dry_run',requests:0,limits:{maxRequests,maxOutputTokens:modelAuditLimits.maxOutputTokens,timeoutMs},results:[]};
 for(const target of targets){
  const record={...describe(target),status:'not_run',attempted:false,elapsedMs:0,usage:{}};
  report.results.push(record);
  if(target.provider==='unsupported'){record.status='not_testable';record.code='unsupported_endpoint_or_protocol';continue}
  if(target.provider==='workers-ai'&&typeof target.config.ai?.run!=='function'){record.status='not_testable';record.code='native_binding_unavailable';continue}
  if(target.credentialConflict){record.status='not_testable';record.code='conflicting_credentials';continue}
  if(target.provider!=='workers-ai'&&!validKey(target.config.key)){record.status='not_testable';record.code='invalid_credentials';continue}
  if(!live){record.code='live_flag_required';continue}
  if(signal?.aborted){record.code='cancelled';continue}
  if(report.requests>=maxRequests){record.code='request_budget_exhausted';continue}
  const start=performance.now(),timer=deadline(signal,timeoutMs);
  record.attempted=true;report.requests++;
  try{
   await probe(target,{fetchImpl,signal:timer.signal,timeoutMs},record);record.status='passed';record.code='synthetic_probe_passed';
  }catch(error){
   record.status='failed';Object.assign(record,timer.signal.aborted?{code:signal?.aborted?'cancelled':'timeout'}:safeFailure(error));
  }finally{timer.close();record.elapsedMs=elapsed(start)}
 }
 if(live){
  const attempted=report.results.filter(result=>result.attempted),passed=attempted.filter(result=>result.status==='passed');
  report.status=!attempted.length?'not_run':passed.length===report.results.length?'passed':passed.length?'partial':'failed';
  if(!targets.length)report.code='no_configured_models';
 }
 return report;
}
