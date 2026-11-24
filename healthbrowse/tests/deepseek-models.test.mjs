import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deepseekPayload,readDeepSeekResult} from '../server/deepseek-client.mjs';
import {modelEndpoint,DEEPSEEK_MODELS,HF_CHAT_URL} from '../server/model-provider.mjs';
import {modelStatus,modelAPI} from '../server/model-api.mjs';

const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'server-hf-only',RETRIEVAL_LIVE:'off',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public'};
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
const input={question:'What is the main function of the pituitary gland?',topic:'Pituitary gland',role:'General',mode:'search',deck:0};
const database=changes=>({prepare:()=>({bind:()=>({run:async()=>({meta:{changes}})})})});
function call(body,config,path='/api/ai/answer',auth='Bearer session-test-token'){
 return modelAPI(new Request('https://site.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(body)}),config,assets);
}
test('three DeepSeek roles are pinned to exact models and the fixed Hugging Face router',()=>{
 for(const [role,id] of Object.entries(DEEPSEEK_MODELS)){
  assert.equal(modelEndpoint({...env,HF_TOKEN:'',GROQ_API_KEY:'unrelated'},role),null);
  const endpoint=modelEndpoint({...env,MODEL_GENERAL_URL:'https://unrelated.example/v1',MODEL_GENERAL_KEY:'unrelated'},role);
  assert.equal(endpoint.url,HF_CHAT_URL);assert.equal(endpoint.key,env.HF_TOKEN);assert.equal(endpoint.model,id);
 }
 assert.equal(modelEndpoint({...env,DEEPSEEK_GENERAL_MODEL:DEEPSEEK_MODELS.professional},'general'),null);
 assert.equal(modelEndpoint({...env,DEEPSEEK_CLINICIAN_MODEL:'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B'},'professional').model,'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B');
 const light='deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
 assert.equal(modelEndpoint({...env,DEEPSEEK_GENERAL_MODEL:light},'general').model,light);
 assert.equal(modelEndpoint({...env,MODEL_PROVIDER:'groq'},'agent'),null);
 assert.equal(modelStatus(env).agent.model,DEEPSEEK_MODELS.agent);
 assert.ok(!JSON.stringify(modelStatus(env)).includes(env.HF_TOKEN));
});

test('portable completion accepts only schema-conformant final JSON from the requested model',()=>{
 const schema={type:'object',required:['value'],properties:{value:{type:'string',enum:['pass']}}};
 const payload=deepseekPayload(DEEPSEEK_MODELS.general,[{role:'system',content:'Return data.'}],100,schema);
 assert.equal(payload.max_tokens,100);assert.equal(payload.response_format,undefined);assert.equal(payload.reasoning_effort,undefined);
 const response=(content,model=DEEPSEEK_MODELS.general,finish_reason='stop')=>({model,choices:[{finish_reason,message:{content,reasoning_content:'private'}}]});
 const read=result=>readDeepSeekResult(result,DEEPSEEK_MODELS.general,schema);
 assert.deepEqual(read(response('<think>private</think>\n{"value":"pass"}')),{value:'pass'});
 assert.deepEqual(read(response('{"value":"pass"}','DeepSeek-R1-Distill-Llama-8B')),{value:'pass'});
 const deckSchema={type:'object',required:['deck'],properties:{deck:{type:'integer',enum:[1,2,3,4,5,6]}}};
 const readDeck=deck=>readDeepSeekResult(response(JSON.stringify({deck})),DEEPSEEK_MODELS.general,deckSchema);
 assert.deepEqual(readDeck(2),{deck:2});
 for(const invalid of ['2',2.5,0,7,null])assert.throws(()=>readDeck(invalid));

 for(const invalid of [response('{"value":"pass"}',DEEPSEEK_MODELS.agent),response('{"value":"pass"}',DEEPSEEK_MODELS.general,'length'),response('{"value":"pass","reasoning":"private"}'),response('{"value":4}'),response('{"value":"other"}'),response('<think>unfinished'),response('{"value":"<think>private</think>"}')])assert.throws(()=>read(invalid));
});

test('both role models independently verify browser summaries and Buddy deck claims',async t=>{
 const requests=[];
 let deckVerdict='supported';
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,HF_CHAT_URL);assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,'Bearer '+env.HF_TOKEN);
  const body=JSON.parse(opts.body);const data=JSON.parse(body.messages[1].content);
  const clinician=body.model===DEEPSEEK_MODELS.professional;
  let output;
  if(data.claims){
   requests.push({model:body.model,review:data.claims.map(c=>c.id)});
   output={checks:data.claims.map(c=>{
    const verdict=c.id.startsWith('D')?deckVerdict:'supported';
    return {id:c.id,verdict,sources:verdict==='supported'?c.sources:[],...(clinician?{quotes:verdict==='supported'?[c.text]:[]}:{})};
   })};
  }else{
   requests.push({model:body.model,mode:data.mode});
   const s=data.evidence.find(s=>s.text.includes('hormones that affect growth'));
   const answer=[{text:s.text,sources:[s.id],...(clinician?{section:'synthesis'}:{})}];
   output={answer};
   if(data.mode==='search'){
    assert.equal(data.deckEvidence,undefined);
    assert.equal(data.domains,undefined);
    assert.doesNotMatch(body.messages[0].content,/six (?:medical |clinical |learning )?(?:decks|domains)|FAQ order/i);
   }else{
    assert.deepEqual(data.deckEvidence.map(d=>d.deck),[1,2,3,4,5,6]);
    const mechanism=data.deckEvidence.find(d=>d.deck===2).passages[0];
    output.deckClaims=[{deck:2,text:mechanism.text,sources:[mechanism.id]}];
   }
  }
  return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:'<think>private</think>'+JSON.stringify(output)}}]});
 });
 for(const [role,model] of [['General',DEEPSEEK_MODELS.general],['Clinicians',DEEPSEEK_MODELS.professional]]){
  for(const [mode,verdict] of [['search','supported'],['chat','supported'],['chat','unsupported']]){
   deckVerdict=verdict;
   const res=await call({...input,role,mode},{...env,DB:database(1)});assert.equal(res.status,200);
   const result=await res.json();assert.equal(result.status,'generated');assert.equal(result.protocol,'deepseek-cited-v1');
   assert.equal(result.answer.generation.model,model);
   assert.match(result.answer.blocks[0].references[0].quote,/hormones that affect growth/);
   assert.doesNotMatch(JSON.stringify(result),/<think>|private<\/think>/);
   const reviewed=mode==='chat'?['C1','D2']:['C1'];
   assert.deepEqual(requests.splice(0),[{model,mode},{model,review:reviewed}]);
   if(mode==='search'){
    assert.deepEqual(result.decks,[]);
   }else{
    assert.deepEqual(result.decks.map(d=>d.deck),[1,2,3,4,5,6]);
    const block=result.decks[1].blocks[0];
    assert.match(block.verification,verdict==='supported'?/AI summary/:/Verbatim source excerpt/);
    assert.match(block.references[0].quote,/hormones that affect growth/);
   }
  }
 }
});

test('failed model requests preserve source excerpts without model attribution or switching providers',async t=>{
 let completions=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,HF_CHAT_URL);completions++;return Response.json({}, {status:402});
 });
 const result=await (await call(input,{...env,DB:database(1)})).json();
 assert.equal(result.status,'sourced');assert.equal(result.code,'provider_credits');assert.equal(completions,1);
 assert.deepEqual(result.decks,[]);assert.equal(result.answer.generation,undefined);assert.match(result.answer.blocks[0].references[0].url,/^https:/);
});

test('standalone evidence endpoint enforces scope, sessions, quotas and document boundaries',async t=>{
 const path='/api/ai/evidence',config={...env,DB:database(1)};
 const {question,topic,role}=input,body={question,topic,role};let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{
  assert.equal(url,'https://auth.example/auth/v1/user');calls++;
  return Response.json({id:'11111111-1111-4111-8111-111111111111'});
 });
 assert.equal((await call(body,config,path,'')).status,401);
 assert.equal((await call({...body,attachments:[]},config,path)).status,400);
 assert.equal((await call({...body,mode:'chat'},config,path)).status,400);
 assert.equal((await call({...body,browserContext:'irrelevant'},config,path)).status,400);
 assert.equal((await call({...body,question:'What is payroll?',topic:'Payroll'},config,path)).status,422);
 assert.equal(calls,0);
 assert.equal((await call(body,{...config,DB:database(0)},path)).status,429);
 const result=await call(body,config,path);
 assert.equal(result.status,200);assert.deepEqual(Object.keys(await result.json()).sort(),['evidence_gaps','query_decomposition','retrieved_sources']);
 const clarification=await (await call({question:'What is RA?',topic:'',role:'Clinicians'},config,path)).json();
 assert.deepEqual(clarification.retrieved_sources,[]);assert.match(clarification.evidence_gaps[0],/more than one/);
 assert.equal(calls,3);
});

test('clinical failover preserves six decks and verifies the same retrieved evidence',async t=>{
 const options={...env,DB:database(1),MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'test-groq'};
 const groq='https://api.groq.com/openai/v1/chat/completions';
 const backupModel='openai/gpt-oss-120b';
 const calls=[];
 let rejectedStage='draft',groqDown=false;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  const body=JSON.parse(opts.body),data=JSON.parse(body.messages[1].content);
  const stage=data.claims?'review':'draft',isGroq=url===groq;
  assert.equal(url,isGroq?groq:HF_CHAT_URL);
  assert.equal(body.model,isGroq?backupModel:DEEPSEEK_MODELS.professional);
  assert.equal(opts.headers.Authorization,isGroq?'Bearer test-groq':'Bearer server-hf-only');
  calls.push((isGroq?'groq':'hf')+'-'+stage);
  if(!isGroq&&stage===rejectedStage)return Response.json({error:{code:'model_not_supported'}},{status:400});
  if(isGroq&&groqDown)return new Response(null,{status:503});
  const source=data.evidence?.find(s=>s.text.includes('hormones that affect growth'));
  const deck=data.deckEvidence?.find(d=>d.deck===2)?.passages[0];
  const output=data.claims?{checks:data.claims.map(c=>({id:c.id,sources:c.sources,quotes:[c.text],verdict:'supported'}))}
   :{answer:[{text:source.text,sources:[source.id],section:'synthesis'}],
     deckClaims:[{deck:2,text:deck.text,sources:[deck.id]}]};
  return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
 });
 const ask=async()=> (await call({...input,mode:'chat',role:'Clinicians'},options)).json();
 const warnings=t.mock.method(console,'warn',()=>{});
 for(const stage of ['draft','review','neither']){
  rejectedStage=stage;
  const result=await ask();
  assert.equal(result.status,'generated');
  assert.equal(result.answer.generation.model,stage==='draft'?backupModel:DEEPSEEK_MODELS.professional);
  assert.equal(result.reviewModel,stage==='neither'?DEEPSEEK_MODELS.professional:backupModel);
  const fallback=stage==='neither'?undefined:{
   phase:stage==='draft'?'generation':'support_review',primaryModel:DEEPSEEK_MODELS.professional,
   fallbackModel:backupModel,reason:'upstream_http',httpStatus:400
  };
  assert.deepEqual(result.modelFallback,fallback);
  assert.deepEqual(warnings.mock.calls.map(call=>JSON.parse(call.arguments[0])),fallback?[{event:'ai_model_fallback',...fallback}]:[]);
  warnings.mock.resetCalls();
  assert.deepEqual(result.decks.map(d=>d.deck),[1,2,3,4,5,6]);
  assert.match(result.decks[1].blocks[0].verification,/AI summary/);
  assert.deepEqual(calls.splice(0),stage==='draft'?['hf-draft','groq-draft','groq-review']:
   stage==='review'?['hf-draft','hf-review','groq-review']:['hf-draft','hf-review']);
 }
 rejectedStage='draft';groqDown=true;
 const excerpt=await ask();
 assert.equal(excerpt.protocol,'source-excerpts-v1');
 assert.equal(excerpt.modelFallback.httpStatus,400);
 assert.equal(excerpt.answer.generation,undefined);
 assert.equal(excerpt.decks.length,6);
 assert.deepEqual(calls.splice(0),['hf-draft','groq-draft']);
 assert.equal((await call(input,{...options,DB:database(0)})).status,429);
 assert.equal(calls.length,0);
});

test('General search uses the backup and withholds a draft if its review fails',async t=>{
 const config={...env,DB:database(1),MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'test-only'};
 let reviewUnavailable=false;
 t.mock.method(globalThis,'fetch',async(url,request)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  if(url===HF_CHAT_URL)throw new TypeError('network unavailable');
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  const body=JSON.parse(request.body),data=JSON.parse(body.messages[1].content);
  if(data.claims&&reviewUnavailable)return new Response(null,{status:503});
  const source=data.evidence?.find(s=>s.text.includes('hormones that affect growth'));
  const content=data.claims?{checks:data.claims.map(c=>({id:c.id,sources:c.sources,verdict:'supported'}))}
   :{answer:[{text:source.text,sources:[source.id]}]};
  return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
 });
 const accepted=await (await call(input,config)).json();
 assert.equal(accepted.status,'generated');
 assert.equal(accepted.protocol,'groq-cited-v1');
 assert.deepEqual(accepted.modelFallback,{phase:'generation',primaryModel:DEEPSEEK_MODELS.general,fallbackModel:'openai/gpt-oss-120b',reason:'network_error'});
 assert.equal(accepted.answer.generation.model,'openai/gpt-oss-120b');
 assert.deepEqual(accepted.decks,[]);
 reviewUnavailable=true;
 const unavailable=await (await call(input,config)).json();
 assert.equal(unavailable.protocol,'source-excerpts-v1');
 assert.deepEqual(unavailable.modelFallback,accepted.modelFallback);
 assert.equal(unavailable.answer.generation,undefined);
 reviewUnavailable=false;
 const missingPrimary={...config,HF_TOKEN:''};
 assert.equal(modelStatus(missingPrimary).general.primaryConfigured,false);
 assert.equal(modelStatus(missingPrimary).general.configured,true);
 assert.equal(modelStatus(config).general.primaryConfigured,true);
 const backupOnly=await (await call(input,missingPrimary)).json();
 assert.equal(backupOnly.status,'generated');
 assert.equal(backupOnly.modelFallback.reason,'primary_unconfigured');
});

test('Buddy sends the chosen model to the API and uses it for generation and citation review',async t=>{
 const {requestSynthesis}=await import('../dist/model-client.js');
 const cfg={...env,DB:database(1),MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'fixture-groq'};
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  const payload=JSON.parse(options.body),context=JSON.parse(payload.messages[1].content);
  calls.push([url,payload.model,!!context.claims]);
  const source=context.evidence?.find(s=>s.text.includes('hormones that affect growth'));
  const answer=context.claims?{checks:context.claims.map(c=>({id:c.id,sources:c.sources,verdict:'supported'}))}
   :{answer:[{text:source.text,sources:[source.id]}]};
  return Response.json({model:payload.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
 });
 const fetcher=(path,opts)=>modelAPI(new Request('https://site.test'+path,opts),cfg,assets);
 for(const [buddyModel,model,url] of [['groq','openai/gpt-oss-120b','https://api.groq.com/openai/v1/chat/completions'],['deepseek',DEEPSEEK_MODELS.general,HF_CHAT_URL]]){
  const r=await requestSynthesis({...input,query:input.question},input.question,{
   mode:'chat',deck:1,buddyModel,tokenProvider:async()=>'session-test-token',fetcher});
  assert.equal(r.status,'generated');
  assert.equal(r.answer.generation.model,model);
  assert.equal(r.reviewModel,model);
  assert.equal(r.modelFallback,undefined);
  assert.deepEqual(calls.splice(0),[[url,model,false],[url,model,true]]);
 }
 const search=await call({...input,buddyModel:'groq'},cfg);
 assert.equal(search.status,400);
 const invalid=await call({...input,mode:'chat',buddyModel:'unknown'},cfg);
 assert.equal(invalid.status,400);
 assert.deepEqual(calls,[]);
});
