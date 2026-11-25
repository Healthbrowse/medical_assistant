// Test-only JSON-lines bridge. The caller drives the real General UI. No port is opened.
import {mock} from 'node:test';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {matchesDeepSeekModel} from '../server/deepseek-client.mjs';
import * as workers from '../server/workers-ai.mjs';

const live = process.argv.includes('--live');
const cap = Number(process.argv[2]);
if (!Number.isSafeInteger(cap) || cap < 0) throw Error('Invalid provider call cap');
const cloud = 'https://api.cloudflare.com/client/v4/accounts/';
const groq = 'https://api.groq.com/openai/v1/chat/completions';
const hf = 'https://router.huggingface.co/v1/chat/completions';
const models = {
 gemma: workers.workersModels.general, oss: null,
 deepseek: null, qwen: workers.workersModels.professional,
 llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', mistral: '@cf/mistralai/mistral-small-3.1-24b-instruct',
 'gemma-fallback': workers.workersModels.general
};
const candidates = new Set(['qwen','llama','mistral']);
let profile, trace, spent = 0, capped = false;
const defaults = workers.workersEndpoint;
// Only the test process may run a candidate in the General slot. Keep its real ID
// through generation, local schema validation, review, and the displayed answer.
mock.module(new URL('../server/workers-ai.mjs',import.meta.url),{exports:{
 ...workers,
 workersEndpoint(env,role){
  const endpoint = defaults(env,role);
  return endpoint && role==='general' && candidates.has(profile) ? {...endpoint,model:models[profile]} : endpoint;
 },
 runWorkersCompletion(config,messages,maxTokens,schema,signal){
  if (!['llama','mistral'].includes(profile)) return workers.runWorkersCompletion(config,messages,maxTokens,schema,signal);
  const [system,...rest] = messages;
  return config.ai.run(config.model,{messages:[{...system,content:system.content+'\nReturn only JSON matching this schema: '+JSON.stringify(schema)},...rest],
   max_tokens:maxTokens,temperature:0,stream:false},{signal,returnRawResponse:true});
 }
}});
const {modelAPI,modelStatus} = await import('../server/model-api.mjs');
const {GROQ_MODEL,DEEPSEEK_MODELS} = await import('../server/model-provider.mjs');
models.oss=GROQ_MODEL;
models.deepseek=DEEPSEEK_MODELS.general;
const {buddyModelNames} = await import('../server/public-config.mjs');
const assets = Object.fromEntries(['medline-topics','clinical-passages','grounded-sources','education-sources','topic-list','taxonomy','cardio-policy'].map(
 name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const cfReady = /^[0-9a-f]{32}$/i.test(account) && !!process.env.CLOUDFLARE_API_TOKEN;
const cfURL = cloud+account+'/ai/v1/chat/completions';
const nativeFetch = globalThis.fetch;
function simulated(model,stage,data) {
 if(profile==='gemma-fallback' && model===models.gemma) return Response.json({code:3036},{status:429});
 let result;
 if(stage==='review') result={checks:data.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources}))};
 else {
  // Copy short sentences from the supplied evidence. The fixture tests wiring,
  // source handling and grading and cannot measure the quality of any real model.
  const cues = /diabet|insulin/i.test(data.question) ? /insulin|blood sugar|glucose/i :
   /heart attack/i.test(data.question) ? /blood (?:flow|supply)|oxygen|blocked|blockage/i : /upper.arm|readings|monitor/i;
  const sentences=(data.evidence || []).flatMap(p=>p.text.split(/(?<=[.!?])\s+/)
   .map(text=>({text,sources:[p.id]}))).filter(c=>c.text.length>25 && c.text.length<500);
  const relevant=sentences.filter(c=>cues.test(c.text));
  const chosen=relevant.length?relevant:sentences;
  result={answer:chosen.filter((c,i)=>chosen.findIndex(a=>a.text===c.text)===i).slice(0,3)};
  if(data.deckEvidence) result.deckClaims=[];
 }
 return Response.json({model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
}
async function completion(url,body,signal){
 const data=JSON.parse(body.messages[1].content);
 const stage=Array.isArray(data.claims)?'review':'generation';
 if(live && spent>=cap){capped=true;return Response.json({error:'QA call cap'},{status:409})}
 const start=performance.now();
 const call={model:body.model,stage};trace.push(call);
 if(live)spent++;
 try {
  const key=url===groq?process.env.GROQ_API_KEY:url===hf?process.env.HF_TOKEN:process.env.CLOUDFLARE_API_TOKEN;
  const res=live?await nativeFetch(url,{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)}):simulated(body.model,stage,data);
  call.http=res.status;
  if(live && res.ok){
   const metadata=await res.clone().json();
   call.reportedModel=metadata.model||null;
   call.modelMismatch=!matchesDeepSeekModel(metadata.model,body.model);
   if(metadata.usage)call.tokens={input:metadata.usage.prompt_tokens,output:metadata.usage.completion_tokens};
  }
  return res;
 } finally {call.ms=Math.round(performance.now()-start)}
}
globalThis.fetch=async (url,opts)=>{
 if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
 if(url===groq || url===hf)return completion(url,JSON.parse(opts.body),opts.signal);
 throw Error('Unexpected network call in QA');
};
function configuration(){
 const provider=profile==='oss'?'groq':profile==='deepseek'?'deepseek':'workers-ai';
 return {MODEL_PROVIDER:provider,RETRIEVAL_LIVE:'off',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'fixture',
  GROQ_API_KEY:live?process.env.GROQ_API_KEY:'fixture',HF_TOKEN:live?process.env.HF_TOKEN:'fixture',
  MODEL_FALLBACK_PROVIDER:['gemma','gemma-fallback','deepseek'].includes(profile)?'groq':'',
  AI:{run:(model,body,opts)=>completion(cfURL,{...body,model},opts.signal)},
  DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})}};
}
const available = key=>!live || (key==='gemma-fallback'?false:key==='oss'?!!process.env.GROQ_API_KEY:key==='deepseek'?!!process.env.HF_TOKEN:cfReady);
const send = value=>process.stdout.write(JSON.stringify(value)+'\n');
console.info=console.warn=()=>{}; // Reserve stdout for the bridge protocol.
send({models,available:Object.fromEntries(Object.keys(models).map(k=>[k,available(k)]))});
for await(const line of createInterface({input:process.stdin})){
 try {
  const input=JSON.parse(line);profile=input.profile;
  if(!Object.hasOwn(models,profile)||!available(profile))throw Error('Unavailable profile');
  const env=configuration();
  if(input.path==='/api/config'){
   const names=buddyModelNames(env);
   if(names.workers)names.workers.general=models[profile];
   send({data:{supabaseUrl:'https://auth.example',supabaseAnonKey:'fixture',buddyModels:names}});continue;
  }
  if(input.path==='/api/ai/status'){send({data:modelStatus(env)});continue;}
  if(input.path!=='/api/ai/answer')throw Error('Unknown operation');
  trace=[];capped=false;
  const request=new Request('https://qa.invalid/api/ai/answer',{method:'POST',headers:{Authorization:input.authorization||'', 'Content-Type':'application/json'},body:JSON.stringify(input.body)});
  const response=await modelAPI(request,env,assets);
  send({http:response.status,data:await response.json(),trace,spent,capped});
 }catch{send({error:'QA bridge could not process the request'})}
}
