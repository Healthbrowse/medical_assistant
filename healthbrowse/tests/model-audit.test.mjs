import test from 'node:test';
import assert from 'node:assert/strict';
import {runModelAudit,modelAuditInventory,modelAuditLimits} from '../server/model-audit.mjs';
import {HF_CHAT_URL,GROQ_CHAT_URL,DEEPSEEK_MODELS} from '../server/model-provider.mjs';
import {workersModels} from '../server/workers-ai.mjs';
import {SARVAM_API_BASE,SARVAM_FLASH_MODEL,SarvamError} from '../server/sarvam-client.mjs';
import {main} from '../scripts/audit-models.mjs';

const groq20='openai/gpt-oss-20b',groq120='openai/gpt-oss-120b';
const groqEnv={MODEL_PROVIDER:'groq',GROQ_MODEL:groq20,GROQ_API_KEY:'fixture-groq-key'};
const usage={prompt_tokens:12,completion_tokens:7,total_tokens:19,completion_tokens_details:{reasoning_tokens:2}};
const completion=(model,overrides={})=>({model,choices:[{finish_reason:'stop',message:{content:'{"status":"ok","total":5}'}}],usage,...overrides});
const allEnv=()=>({MODEL_PROVIDER:'groq',GROQ_API_KEY:'fixture-groq-key',HF_TOKEN:'fixture-hf-key',SARVAM_API_KEY:'fixture-sarvam-key',
 AI:{run:async()=>Response.json({response:'{"status":"ok","total":5}',usage})}});

test('dry inventory includes browser choices and hidden reviewer/planner without any network or binding calls',async()=>{
 let calls=0;const env=allEnv();env.AI.run=async()=>{calls++;throw Error('must not run')};
 const result=await runModelAudit({env,fetchImpl:async()=>{calls++;throw Error('must not fetch')}});
 assert.equal(result.status,'dry_run');assert.equal(result.requests,0);assert.equal(calls,0);
 assert.equal(new Date(result.checkedAt).toISOString(),result.checkedAt);
 const inventory=modelAuditInventory(env);
 assert.ok(inventory.find(item=>item.model===groq20)?.purposes.includes('reviewer:professional'));
 assert.ok(inventory.find(item=>item.model===DEEPSEEK_MODELS.agent)?.purposes.includes('planner:deepseek'));
 assert.equal(new Set(inventory.map(item=>item.model)).size,8);
 const serialized=JSON.stringify(result);
 for(const secret of [env.HF_TOKEN,env.GROQ_API_KEY,env.SARVAM_API_KEY,HF_CHAT_URL,GROQ_CHAT_URL])assert.ok(!serialized.includes(secret));
});

test('live audit pins every unique model, transport and credential once, using only the fixed synthetic probe',async()=>{
 const env=allEnv(),calls=[];
 env.PATIENT_NOTE='PRIVATE PATIENT NOTE MUST NOT BE SUBMITTED';
 env.AI.run=async(model,body,options)=>{
  calls.push(model);assert.equal(body.max_completion_tokens,512);assert.equal(options.returnRawResponse,true);
  assert.ok(options.signal instanceof AbortSignal);assert.ok(!JSON.stringify(body).includes(env.PATIENT_NOTE));
  return Response.json({response:'{"status":"ok","total":5}',usage});
 };
 const report=await runModelAudit({env,live:true,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body.model);
  assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  assert.ok(options.signal instanceof AbortSignal);assert.ok(!options.body.includes(env.PATIENT_NOTE));
  assert.equal(body.max_tokens||body.max_completion_tokens,512);assert.equal(body.stream,false);
  assert.ok(body.messages.some(message=>message.content.includes('sum of 2 and 3')));
  if(url===HF_CHAT_URL)assert.equal(options.headers.Authorization,'Bearer '+env.HF_TOKEN);
  else if(url===GROQ_CHAT_URL)assert.equal(options.headers.Authorization,'Bearer '+env.GROQ_API_KEY);
  else{assert.equal(url,SARVAM_API_BASE+'/chat/completions');assert.equal(options.headers['api-subscription-key'],env.SARVAM_API_KEY);assert.equal(options.headers.Authorization,undefined)}
  return Response.json(completion(body.model));
 }});
 assert.equal(report.status,'passed');assert.equal(report.clinicalValidation,false);assert.equal(report.requests,8);
 assert.equal(calls.length,8);assert.equal(new Set(calls).size,8);
 assert.deepEqual(new Set(calls),new Set([...Object.values(workersModels),...Object.values(DEEPSEEK_MODELS),groq20,groq120,SARVAM_FLASH_MODEL]));
 for(const result of report.results){
  assert.equal(result.status,'passed');assert.equal(result.usage.totalTokens,19);assert.ok(result.elapsedMs>=0);
  assert.equal(result.modelIdentity,result.provider==='workers-ai'?'pinned_native_binding':'exact_reported_id');
 }
});

test('provider failure stays attached to the requested checkpoint instead of being rescued by the configured backup',async()=>{
 const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'fixture-hf',GROQ_API_KEY:'fixture-groq',MODEL_FALLBACK_PROVIDER:'groq'},calls=[];
 const report=await runModelAudit({env,live:true,fetchImpl:async(url,options)=>{
  const {model}=JSON.parse(options.body);calls.push(model);
  return url===HF_CHAT_URL?Response.json({error:{message:'PRIVATE '+env.HF_TOKEN}},{status:503}):Response.json(completion(model));
 }});
 assert.equal(report.requests,4);assert.equal(new Set(calls).size,4);
 assert.equal(report.results.filter(item=>item.provider==='huggingface'&&item.status==='failed').length,3);
 assert.equal(report.results.find(item=>item.model===groq120).status,'passed');
 assert.ok(report.results.filter(item=>item.provider==='huggingface').every(item=>item.code==='provider_unavailable'));
 assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes(env.HF_TOKEN));
});

test('OpenAI-style identity checks reject missing IDs and legitimate-looking HF aliases without declaring retirement',async()=>{
 const env=allEnv();delete env.AI;
 const report=await runModelAudit({env,live:true,fetchImpl:async(_url,options)=>{
  const model=JSON.parse(options.body).model;
  const reported=model===DEEPSEEK_MODELS.agent?'deepseek/deepseek-v3.2':undefined;
  return Response.json(completion(reported));
 }});
 assert.equal(report.requests,6);assert.ok(report.results.every(item=>item.status==='failed'&&item.code==='model_mismatch'));
 assert.equal(report.results.find(item=>item.model===DEEPSEEK_MODELS.agent).modelIdentity,'reported_id_mismatch');
 assert.ok(!JSON.stringify(report).includes('model_retired'));
});

test('HTTP diagnostics distinguish access, credits, rate limits, redirects, retirement and invalid requests without raw errors',async()=>{
 for(const [httpStatus,code] of [[401,'authentication_error'],[403,'access_denied'],[402,'credits_exhausted'],[429,'rate_limited'],
  [302,'redirect_blocked'],[410,'endpoint_gone'],[404,'model_unavailable'],[400,'configuration_error'],[422,'configuration_error'],[503,'provider_unavailable']]){
  let calls=0;
  const report=await runModelAudit({env:groqEnv,live:true,fetchImpl:async()=>{
   calls++;return Response.json({error:{message:'PRIVATE '+groqEnv.GROQ_API_KEY,url:'https://secret.example'}},{status:httpStatus,headers:{Location:'https://secret.example'}});
  }});
  assert.equal(calls,1);assert.equal(report.results[0].code,code);assert.equal(report.results[0].httpStatus,httpStatus);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes('secret.example'));
 }
});

test('Sarvam authentication errors and unexpected exception metadata remain safe',async()=>{
 const env={MODEL_PROVIDER:'sarvam',SARVAM_API_KEY:'fixture-sarvam-key'};
 const denied=await runModelAudit({env,live:true,fetchImpl:async()=>Response.json({error:'PRIVATE'},{status:401})});
 assert.equal(denied.results[0].code,'authentication_error');assert.equal(denied.results[0].httpStatus,401);
 const injected=await runModelAudit({env,live:true,fetchImpl:async()=>{throw new SarvamError('PRIVATE',undefined,{secret:env.SARVAM_API_KEY,totalTokens:3})}});
 assert.equal(injected.results[0].code,'provider_unavailable');assert.deepEqual(injected.results[0].usage,{totalTokens:3});
 assert.ok(!JSON.stringify(injected).includes('PRIVATE'));assert.ok(!JSON.stringify(injected).includes(env.SARVAM_API_KEY));
});

test('Workers error codes preserve plan and quota failures and distinguish explicit retirement',async()=>{
 for(const [status,providerCode,code] of [[403,5035,'paid_plan_required'],[429,3036,'quota_exhausted'],[429,3040,'capacity_unavailable'],[410,5028,'model_retired']]){
  const env={MODEL_PROVIDER:'workers-ai',AI:{run:async()=>Response.json({success:false,errors:[{code:providerCode,message:'PRIVATE'}]},{status})}};
  const report=await runModelAudit({env,live:true,fetchImpl:async()=>{throw Error('unexpected HTTP')}});
  assert.equal(report.requests,2);assert.ok(report.results.every(item=>item.code===code&&item.providerCode===providerCode));
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
 }
});

test('format/truncation failures retain safe billed usage and never expose content or retry',async()=>{
 for(const [payload,code] of [
  [completion(groq20,{choices:[{finish_reason:'length',message:{content:'PRIVATE'}}]}),'output_truncated'],
  [completion(groq20,{choices:[{finish_reason:'stop',message:{content:'{"status":"ok","total":6}'}}]}),'invalid_output'],
  [completion(groq20,{choices:[{finish_reason:'stop',message:{content:'{PRIVATE '+groqEnv.GROQ_API_KEY+'}'}}]}),'invalid_output'],
  [completion(groq20,{choices:[{finish_reason:'stop',message:{content:'{"status":"ok","total":5}',refusal:'PRIVATE'}}]}),'refused']
 ]){
  let calls=0;const report=await runModelAudit({env:groqEnv,live:true,fetchImpl:async()=>{calls++;return Response.json(payload)}});
  assert.equal(calls,1);assert.equal(report.results[0].code,code);assert.equal(report.results[0].usage.totalTokens,19);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes(groqEnv.GROQ_API_KEY));
 }
});

test('request budget, timeout and caller cancellation bound work even if the transport ignores cancellation',async()=>{
 let calls=0;const env=allEnv();delete env.AI;
 const report=await runModelAudit({env,live:true,maxRequests:2,fetchImpl:async(_url,options)=>{calls++;return Response.json(completion(JSON.parse(options.body).model))}});
 assert.equal(calls,2);assert.equal(report.requests,2);assert.equal(report.results.filter(item=>item.code==='request_budget_exhausted').length,4);
 const timed=await runModelAudit({env:groqEnv,live:true,timeoutMs:5,fetchImpl:async()=>new Promise(()=>{})});
 assert.equal(timed.requests,1);assert.equal(timed.results[0].code,'timeout');
 const controller=new AbortController();controller.abort();calls=0;
 const cancelled=await runModelAudit({env:groqEnv,live:true,signal:controller.signal,fetchImpl:async()=>{calls++}});
 assert.equal(calls,0);assert.equal(cancelled.results[0].code,'cancelled');
 await assert.rejects(runModelAudit({maxRequests:modelAuditLimits.maxRequests+1}),error=>error.code==='invalid_audit_options');
});

test('missing native binding and arbitrary legacy endpoint are not_testable and never produce network failures',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected fetch')};
 const workers=await runModelAudit({env:{MODEL_PROVIDER:'workers-ai'},live:true,fetchImpl});
 assert.equal(workers.requests,0);assert.equal(workers.status,'not_run');assert.equal(workers.results.length,2);
 assert.ok(workers.results.every(item=>item.status==='not_testable'&&item.code==='native_binding_unavailable'));
 const disabled=await runModelAudit({env:{MODEL_PROVIDER:'workers-ai',MODEL_DISABLED_MODELS:workersModels.general},live:true,fetchImpl});
 assert.equal(disabled.requests,0);assert.equal(disabled.results.length,1);assert.equal(disabled.results[0].model,workersModels.professional);
 const allDisabled=await runModelAudit({env:{MODEL_PROVIDER:'workers-ai',MODEL_DISABLED_MODELS:Object.values(workersModels).join(',')},live:true,fetchImpl});
 assert.equal(allDisabled.results.length,0);assert.equal(allDisabled.code,'no_configured_models');
 const custom=await runModelAudit({env:{MODEL_GENERAL_URL:'https://private.example/api',MODEL_GENERAL_KEY:'PRIVATE-KEY',MODEL_GENERAL_ID:'PRIVATE-MODEL'},live:true,fetchImpl});
 assert.equal(custom.results[0].status,'not_testable');assert.equal(custom.results[0].model,null);assert.equal(calls,0);
 assert.ok(!JSON.stringify(custom).includes('PRIVATE'));assert.ok(!JSON.stringify(custom).includes('private.example'));
});

test('HF catalog-only audit uses one fixed GET and reports catalog evidence without inference success',async()=>{
 let calls=0;const env={HF_TOKEN:'fixture-hf'};
 const fetchImpl=async(url,options)=>{
  calls++;assert.equal(url,'https://router.huggingface.co/v1/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  assert.equal(options.headers.Authorization,'Bearer '+env.HF_TOKEN);assert.equal(options.redirect,'manual');
  return Response.json({data:[{id:DEEPSEEK_MODELS.agent,secret:env.HF_TOKEN,providers:[{provider:'PRIVATE',status:'live',supports_structured_output:true},{status:'error'}]}]});
 };
 const dry=await runModelAudit({env,hfCatalogOnly:true,fetchImpl});assert.equal(calls,0);assert.equal(dry.status,'dry_run');
 const live=await runModelAudit({env,live:true,hfCatalogOnly:true,fetchImpl});
 assert.equal(calls,1);assert.equal(live.requests,1);assert.equal(live.status,'catalog_only');assert.equal(live.inferenceTested,false);
 assert.equal(new Date(live.checkedAt).toISOString(),live.checkedAt);
 assert.equal(live.results.find(item=>item.model===DEEPSEEK_MODELS.agent).liveProviders,1);
 assert.equal(live.results.filter(item=>item.status==='catalog_unlisted').length,2);
 assert.ok(live.results.every(item=>item.retirementEstablished===false));
 assert.ok(!JSON.stringify(live).includes('PRIVATE'));assert.ok(!JSON.stringify(live).includes(env.HF_TOKEN));
});

test('catalog review retains disabled HF candidates while inference respects the same operator policy',async()=>{
 const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'fixture-hf',MODEL_DISABLED_MODELS:Object.values(DEEPSEEK_MODELS).join(',')};
 let calls=0;
 const inference=await runModelAudit({env,live:true,fetchImpl:async()=>{calls++;throw Error('disabled inference must not run')}});
 assert.equal(calls,0);assert.equal(inference.requests,0);assert.equal(inference.results.length,0);
 const catalog=await runModelAudit({env,live:true,hfCatalogOnly:true,fetchImpl:async(_url,options)=>{
  calls++;assert.equal(options.method,'GET');return Response.json({data:[{id:DEEPSEEK_MODELS.agent,providers:[{status:'live'}]}]});
 }});
 assert.equal(calls,1);assert.equal(catalog.results.length,3);
 assert.ok(catalog.results.every(item=>item.operatorDisabled&&item.retirementEstablished===false));
 assert.equal(catalog.results.find(item=>item.model===DEEPSEEK_MODELS.agent).status,'catalog_listed');
 assert.equal(catalog.results.find(item=>item.model===DEEPSEEK_MODELS.general).status,'catalog_unlisted');
});

test('CLI requires explicit live flag and rejects key/URL/case arguments without echoing them',async()=>{
 const output=[];let calls=0;
 const options={write:value=>output.push(value),fetchImpl:async()=>{calls++;throw Error('unexpected fetch')}};
 assert.equal(await main([],groqEnv,options),0);assert.equal(JSON.parse(output.pop()).requests,0);
 assert.equal(await main(['--hf-catalog'],groqEnv,options),0);assert.equal(JSON.parse(output.pop()).status,'dry_run');
 assert.equal(await main(['--api-key=PRIVATE'],groqEnv,options),2);assert.ok(!output.pop().includes('PRIVATE'));
 assert.equal(calls,0);
});
