import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelAPI} from '../server/model-api.mjs';
import {DEEPSEEK_MODELS,HF_CHAT_URL,GROQ_CHAT_URL} from '../server/model-provider.mjs';
import {workersModels} from '../server/workers-ai.mjs';

const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
const input={topic:'Pituitary gland',question:'What is the main function of the pituitary gland?',role:'General',mode:'chat',deck:1};
const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'fixture-hf',GROQ_API_KEY:'fixture-groq',MODEL_FALLBACK_PROVIDER:'groq',RETRIEVAL_LIVE:'off',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})}};
const call=(body,config)=>modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-session'},body:JSON.stringify(body)}),config,assets);

test('explicit Buddy model failures never invoke an alternate provider',async t=>{
 const seen=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,HF_CHAT_URL,'A selected model must not silently use Groq');
  seen.push(JSON.parse(options.body).model);
  return new Response(null,{status:503});
 });
 const AI={async run(model){seen.push(model);return new Response(null,{status:503});}};
 for(const [buddyModel,model] of [['deepseek',DEEPSEEK_MODELS.general],['workers-ai',workersModels.general]]){
  const response=await call({...input,buddyModel},{...env,AI});
  const body=await response.json();
  assert.notEqual(body.status,'generated');
  assert.equal(body.code,'provider_unavailable');
  assert.equal(body.modelFallback,undefined);
  assert.deepEqual(seen.splice(0),[model]);
 }
});

test('stale Buddy selections fail before authentication or billable inference',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('Unavailable choice must not call a provider'));
 const response=await call({...input,buddyModel:'deepseek'},{...env,HF_TOKEN:''});
 assert.equal(response.status,400);
 assert.equal((await response.json()).code,'buddy_model_unavailable');
});

test('automatic Groq applies model identity, refusal and schema validation',async t=>{
 let reply,requests=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,GROQ_CHAT_URL);requests++;
  return Response.json(reply);
 });
 for(const [code,response] of [
  ['provider_model_mismatch',{model:'unexpected/checkpoint',choices:[{finish_reason:'stop',message:{content:'{"answer":[]}'}}]}],
  ['provider_refusal',{model:'openai/gpt-oss-120b',choices:[{finish_reason:'stop',message:{refusal:'Synthetic refusal',content:'{"answer":[]}'}}]}],
  ['provider_output_invalid',{model:'openai/gpt-oss-120b',choices:[{finish_reason:'stop',message:{content:'{"wrong_schema":[]}'}}]}]
 ]){
  reply=response;requests=0;
  const body=await(await call({...input,mode:'search',deck:0},{...env,MODEL_PROVIDER:'groq'})).json();
  assert.notEqual(body.status,'generated');
  assert.equal(body.modelFailure.code,code);
  assert.equal(requests,1);
 }
});
