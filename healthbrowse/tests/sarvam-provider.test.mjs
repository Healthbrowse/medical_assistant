import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelEndpoint,modelReviewEndpoint,buddyEndpoint,browserModelRoutes,fallbackEndpoint,usesCitedProtocol,sarvamProtocol,HF_CHAT_URL,DEEPSEEK_MODELS} from '../server/model-provider.mjs';
import {SARVAM_API_BASE,SARVAM_FLASH_MODEL} from '../server/sarvam-client.mjs';
import {buddyModelNames} from '../server/public-config.mjs';
import {modelAPI,modelStatus} from '../server/model-api.mjs';

const key='sarvam-test-only-key';
const env={MODEL_PROVIDER:'sarvam',SARVAM_API_KEY:key,MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'unrelated-groq',HF_TOKEN:'unrelated-hf'};
const input={question:'What is the main function of the pituitary gland?',topic:'Pituitary gland',role:'General',mode:'search',deck:0};
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));

test('Sarvam is explicitly selected, pins its own checkpoint and keeps the reviewer on the same route',()=>{
 for(const route of ['general','professional']){
  const generator=modelEndpoint(env,route),reviewer=modelReviewEndpoint(env,route);
  assert.deepEqual(generator,reviewer);
  assert.equal(generator.model,SARVAM_FLASH_MODEL);
  assert.equal(generator.protocol,sarvamProtocol);
  assert.equal(generator.url,SARVAM_API_BASE+'/chat/completions');
  assert.equal(generator.key,key);
  assert.equal(usesCitedProtocol(generator),true);
 }
 assert.equal(modelEndpoint(env,'agent'),null);
 assert.equal(fallbackEndpoint(env),null);
 assert.equal(modelEndpoint({...env,MODEL_PROVIDER:'deepseek'},'general').url,HF_CHAT_URL);
 assert.equal(buddyEndpoint({...env,MODEL_PROVIDER:'deepseek'},'sarvam','general').model,SARVAM_FLASH_MODEL);
 assert.equal(modelStatus(env).professional.model,SARVAM_FLASH_MODEL);
 assert.equal(modelStatus(env).fallback,undefined);
});

test('missing Sarvam credentials or old checkpoint IDs never borrow another provider key or alias a model',()=>{
 for(const patch of [{SARVAM_API_KEY:''},{SARVAM_API_KEY:undefined},{SARVAM_MODEL:DEEPSEEK_MODELS.general},{SARVAM_MODEL:DEEPSEEK_MODELS.professional},{SARVAM_MODEL:DEEPSEEK_MODELS.agent},{SARVAM_MODEL:'deepseekv4-pro'}]){
  const config={...env,...patch};
  assert.equal(modelEndpoint(config,'general'),null);
  assert.equal(modelReviewEndpoint(config,'professional'),null);
  assert.equal(fallbackEndpoint(config),null);
  assert.equal(buddyModelNames(config).sarvam,undefined);
  assert.equal(modelStatus(config).general.configured,false);
 }
 const interactive=SARVAM_FLASH_MODEL+'-interactive';
 assert.equal(modelEndpoint({...env,SARVAM_MODEL:interactive},'professional').model,interactive);
});

test('public choices expose the exact configured Sarvam model without credentials',()=>{
 const catalog=buddyModelNames(env);
 assert.deepEqual(catalog.sarvam,{general:SARVAM_FLASH_MODEL,professional:SARVAM_FLASH_MODEL});
 assert.equal(catalog.preferred,'sarvam');
 assert.doesNotMatch(JSON.stringify(catalog),/sarvam-test-only-key|unrelated-groq|unrelated-hf|api\.sarvam/);
 assert.equal(browserModelRoutes(env).get(SARVAM_FLASH_MODEL).protocol,sarvamProtocol);
 assert.equal(browserModelRoutes({...env,SARVAM_API_KEY:''}).has(SARVAM_FLASH_MODEL),false);
});

function fixture(t,config={}){
 const calls=[];let failStatus=0,wrongModel=false;
 const runtime={...env,RETRIEVAL_LIVE:'off',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',
  DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})},...config};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,SARVAM_API_BASE+'/chat/completions','No request may silently switch providers');
  assert.equal(options.headers['api-subscription-key'],key);
  assert.equal(options.headers.Authorization,undefined);
  assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content);
  calls.push({body,payload});
  assert.equal(body.model,SARVAM_FLASH_MODEL);
  assert.equal(body.reasoning_effort,'none');
  assert.equal(body.response_format.type,'json_schema');
  assert.equal(body.response_format.json_schema.strict,true);
  assert.ok(body.max_tokens>0&&body.max_tokens<=8000);
  assert.doesNotMatch(options.body,/sarvam-test-only-key|unrelated-groq|unrelated-hf/);
  if(failStatus)return Response.json({error:{message:'private diagnostic must never escape'}},{status:failStatus});
  const clinical=payload.role==='Medical professional'||payload.claims?.some(c=>c.section);
  const source=payload.evidence?.[0];
  const answer=payload.claims?{checks:payload.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources,...(body.response_format.json_schema.schema.properties.checks.items.properties.quotes?{quotes:c.sources.map(id=>payload.sources.find(s=>s.id===id).text)}:{})}))}
   :{answer:[{text:source.text.split(/(?<=[.!?])\s+/)[0],sources:[source.id],...(clinical?{section:'synthesis'}:{})}],...(payload.deckEvidence?{deckClaims:[]}:{})};
  return Response.json({model:wrongModel?'unrequested-checkpoint':body.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer)}}],
   usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140,completion_tokens_details:{reasoning_tokens:0},prompt_tokens_details:{cached_tokens:12}}});
 });
 const call=(patch={})=>modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer session-test-token'},body:JSON.stringify({...input,...patch})}),runtime,assets);
 return {calls,call,fail(status){failStatus=status},wrongModel(){wrongModel=true}};
}

test('both reading modes generate and review citations through the same Sarvam model',async t=>{
 const f=fixture(t);
 for(const role of ['General','Clinicians'])for(const mode of ['search','chat']){
  const response=await f.call({role,mode,...(mode==='chat'?{buddyModel:'sarvam'}:{})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.status,'generated');
  assert.equal(result.protocol,sarvamProtocol);
  assert.equal(result.model,SARVAM_FLASH_MODEL);
  assert.equal(result.reviewModel,SARVAM_FLASH_MODEL);
  assert.ok(result.answer.blocks.length>0);
  assert.equal(result.modelFallback,undefined);
  assert.deepEqual(result.usage,{generation:{promptTokens:100,completionTokens:40,totalTokens:140,reasoningTokens:0,cachedTokens:12},review:{promptTokens:100,completionTokens:40,totalTokens:140,reasoningTokens:0,cachedTokens:12}});
  assert.deepEqual(f.calls.splice(0).map(c=>!!c.payload.claims),[false,true]);
 }
});

test('explicit Sarvam selection remains opt-in when the active provider has a Groq fallback',async t=>{
 const f=fixture(t,{MODEL_PROVIDER:'deepseek'});
 for(const patch of [{mode:'chat',buddyModel:'sarvam'},{browserModel:SARVAM_FLASH_MODEL}]){
  const result=await(await f.call(patch)).json();
  assert.equal(result.protocol,sarvamProtocol);
  assert.equal(result.reviewModel,SARVAM_FLASH_MODEL);
  assert.equal(result.modelFallback,undefined);
 }
 f.fail(503);
 const failed=await(await f.call({mode:'chat',buddyModel:'sarvam'})).json();
 assert.equal(failed.status,'sourced');
 assert.equal(failed.modelFallback,undefined);
 assert.equal(failed.answer.generation,undefined);
 assert.equal(f.calls.length,5);
});

test('provider errors show safe source fallback without retries, substitution, or diagnostic leakage',async t=>{
 const f=fixture(t);
 for(const [status,code] of [[403,'provider_access'],[402,'provider_credits'],[404,'provider_configuration'],[429,'provider_busy'],[503,'provider_unavailable']]){
  f.fail(status);
  const result=await(await f.call()).json();
  assert.equal(result.status,'sourced');
  assert.equal(result.code,code);
  assert.equal(result.answer.generation,undefined);
  assert.equal(result.modelFallback,undefined);
  assert.doesNotMatch(JSON.stringify(result),/private diagnostic|sarvam-test-only-key|unrelated-groq|unrelated-hf/);
  assert.equal(f.calls.splice(0).length,1);
 }
});

test('the API rejects unavailable named Sarvam choices and unrequested returned model IDs',async t=>{
 const absent=fixture(t,{SARVAM_API_KEY:''});
 assert.equal((await absent.call({mode:'chat',buddyModel:'sarvam'})).status,400);
 assert.equal(absent.calls.length,0);
 const f=fixture(t);
 f.wrongModel();
 const result=await(await f.call()).json();
 assert.equal(result.status,'sourced');
 assert.equal(result.code,'provider_model_mismatch');
 assert.equal(result.answer.generation,undefined);
 assert.equal(f.calls.length,1);
});
