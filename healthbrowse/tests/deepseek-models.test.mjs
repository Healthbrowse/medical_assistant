import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deepseekPayload,readDeepSeekResult} from '../server/deepseek-client.mjs';
import {browserModelRoutes,modelEndpoint,DEEPSEEK_MODELS,HF_CHAT_URL} from '../server/model-provider.mjs';
import {modelStatus,modelAPI} from '../server/model-api.mjs';
import {buddyModelNames} from '../server/public-config.mjs';
import {workersModels} from '../server/workers-ai.mjs';
import {asksPressureRoutine,pressureRequest,pressureSections,pressureTopic} from '../dist/blood-pressure-routine.js';
import {requestSynthesis} from '../dist/model-client.js';

const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'server-hf-only',RETRIEVAL_LIVE:'off',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public'};
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
const input={question:'What is the main function of the pituitary gland?',topic:'Pituitary gland',role:'General',mode:'search',deck:0};
const database=changes=>({prepare:()=>({bind:()=>({run:async()=>({meta:{changes}})})})});
function call(body,config,path='/api/ai/answer',auth='Bearer session-test-token',catalog=assets){
 return modelAPI(new Request('https://site.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(body)}),config,catalog);
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

test('Workers AI serves both Browser roles and Buddy, with a verified Groq fallback',async t=>{
 let role='General',failure,groqDown=false;
 const calls=[];
 function completion(model,payload){
  const data=JSON.parse(payload.messages[1].content);
  const stage=data.claims?'support_review':'generation';
  calls.push([model,stage]);
  const isWorkers=model.startsWith('@cf/');
  if(isWorkers&&stage===failure)return Response.json({code:3036},{status:429});
  if(!isWorkers&&groqDown)return new Response(null,{status:503});
  const clinical=role==='Clinicians';
  let result;
  if(data.claims){
   result={checks:data.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources,...(clinical?{quotes:[c.text]}:{})}))};
  }else{
   const s=data.evidence[0];
   const sentence=s.text.split(/(?<=[.!?])\s/)[0];
   result={answer:[{text:sentence,sources:[s.id],...(clinical?{section:'synthesis'}:{})}]};
   if(data.deckEvidence)result.deckClaims=[];
  }
  return Response.json({model:model.replace(/^@cf\//,''),choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
 }
 const AI={async run(model,payload,options){
  assert.equal(options.returnRawResponse,true);assert.ok(options.signal instanceof AbortSignal);
  assert.ok(payload.max_completion_tokens>0);
  if(model===workersModels.general){
   assert.deepEqual(payload.response_format,{type:'json_object'});
   assert.equal(payload.chat_template_kwargs.enable_thinking,false);
   assert.match(payload.messages[0].content,/Return only JSON matching this schema:/);
  }else assert.equal(payload.response_format.type,'json_schema');
  assert.equal(payload.reasoning_effort,model===workersModels.professional?'low':undefined);
  assert.equal(JSON.stringify(payload).includes(env.HF_TOKEN),false);
  return completion(model,payload);
 }};
 const config={...env,MODEL_PROVIDER:'workers-ai',AI,DB:database(1),MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'fixture-groq'};
 const groq='openai/gpt-oss-120b';
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  if(url===HF_CHAT_URL){
   assert.equal(opts.headers.Authorization,'Bearer '+env.HF_TOKEN);
  }else{
   assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
   assert.equal(opts.headers.Authorization,'Bearer fixture-groq');
  }
  const payload=JSON.parse(opts.body);return completion(payload.model,payload);
 });
 const status=modelStatus(config);
 assert.deepEqual(status.general,{configured:true,primaryConfigured:true,model:workersModels.general});
 assert.equal(status.professional.model,workersModels.professional);assert.equal(status.provider,'workers-ai');
 assert.equal(status.agent.model,workersModels.agent);assert.equal(status.fallback.model,groq);
 assert.equal(buddyModelNames(config).preferred,'workers-ai');
 const ask=async(mode='search',extra={},options=config)=>(await call({...input,role,mode,...extra},options)).json();
 for(const audience of ['General','Clinicians']){
  role=audience;
  const model=role==='Clinicians'?workersModels.professional:workersModels.general;
  for(const mode of ['search','chat']){
   const result=await ask(mode);
   assert.equal(result.protocol,'workers-ai-cited-v1');assert.equal(result.model,model);
   assert.equal(result.reviewModel,model);assert.equal(result.answer.generation.model,model);
   assert.ok(result.answer.blocks.some(b=>b.references?.length));
   assert.equal(result.decks.length,mode==='chat'?6:0);assert.equal(result.modelFallback,undefined);
   assert.deepEqual(calls.splice(0),[[model,'generation'],[model,'support_review']]);
  }
  for(const topic of ['Type 2 Diabetes','Leukemia','Heart Failure']){
   const result=await ask('search',{topic,question:'What is '+topic+'?'});
   assert.equal(result.model,model,topic);
   assert.ok(result.answer.blocks.some(block=>block.references?.length),topic);
   assert.deepEqual(calls.splice(0),[[model,'generation'],[model,'support_review']]);
  }
 }
 // Manual Browser selection is independent of both the persona and the automatic fallback.
 const manualModels=[workersModels.general,workersModels.professional,DEEPSEEK_MODELS.general,DEEPSEEK_MODELS.professional,groq];
 assert.deepEqual([...browserModelRoutes(config).keys()],manualModels);
 assert.deepEqual([...browserModelRoutes({...config,AI:null,HF_TOKEN:'',GROQ_API_KEY:''}).keys()],[]);
 for(const audience of ['General','Clinicians']){
  role=audience;
  for(const browserModel of manualModels){
   const result=await ask('search',{browserModel});
   assert.equal(result.model,browserModel);
   assert.equal(result.reviewModel,browserModel);
   assert.equal(result.modelFallback,undefined);
   assert.deepEqual(calls.splice(0),[[browserModel,'generation'],[browserModel,'support_review']]);
  }
 }
 for(const stage of ['generation','support_review']){
  failure=stage;
  const result=await ask('search',{browserModel:workersModels.general});
  assert.equal(result.code,'provider_busy');assert.equal(result.status,'sourced');
  assert.equal(result.modelFallback,undefined);
  assert.ok(calls.length&&calls.every(([model])=>model===workersModels.general));
  calls.length=0;
 }
 for(const invalid of [null,{},'__proto__','https://unknown.example','unconfigured-model']){
  const res=await call({...input,browserModel:invalid},config);
  assert.equal(res.status,400);
 }
 for(const override of [{mode:'chat'},{buddyModel:'groq'}]){
  assert.equal((await call({...input,browserModel:groq,...override},config)).status,400);
 }
 assert.equal((await call({...input,browserModel:groq},config,'/api/ai/evidence')).status,400);
 assert.deepEqual(calls,[]);
 for(const stage of ['generation','support_review']){
  failure=stage;
  const result=await ask();
  assert.equal(result.model,stage==='generation'?groq:workersModels.professional);
  assert.equal(result.reviewModel,groq);
  assert.deepEqual(result.modelFallback,{phase:stage,primaryModel:workersModels.professional,fallbackModel:groq,reason:'upstream_http',httpStatus:429});
  assert.equal(calls.filter(([model])=>model===groq).length,stage==='generation'?2:1);calls.length=0;
 }
 groqDown=true;failure='generation';
 const excerpts=await ask();
 assert.equal(excerpts.protocol,'source-excerpts-v1');assert.equal(excerpts.answer.generation,undefined);
 groqDown=false;failure=undefined;
 const missing=await ask('search',{}, {...config,AI:undefined});
 assert.equal(missing.model,groq);assert.equal(missing.modelFallback.reason,'primary_unconfigured');
 assert.equal(missing.modelFallback.primaryModel,workersModels.professional);
 const pilot=await ask('chat',{buddyModel:'workers-ai'},{...config,MODEL_PROVIDER:'deepseek'});
 assert.equal(pilot.model,workersModels.professional);
 const explicitDeepSeek=await ask('chat',{buddyModel:'deepseek'});assert.equal(explicitDeepSeek.model,DEEPSEEK_MODELS.professional);
 const explicitGroq=await ask('chat',{buddyModel:'groq'});assert.equal(explicitGroq.model,groq);

 role='General'; calls.length=0;
 const question='How to manage high blood pressure day to day?';
 const context={topic:question,query:question,role};
 const fetcher=(path,opts)=>modelAPI(new Request('https://site.test'+path,opts),config,assets);
 const run=(mode,questionText=question,deck=0,topic=context.topic)=>requestSynthesis({...context,topic},questionText,
  {mode,deck,tokenProvider:async()=>'session-test-token',fetcher});
 for(const mode of ['search','chat']){
  const result=await run(mode);
  assert.equal(result.status,'generated');assert.equal(result.answer.generation.model,workersModels.general);
  assert.deepEqual(calls.splice(0),[[workersModels.general,'generation'],[workersModels.general,'support_review']]);
  assert.equal(result.decks.length,mode==='chat'?6:0);assert.equal(result.answer.routingNotice,undefined);
  if(mode==='chat'){
   assert.deepEqual(result.decks.map(d=>d.title),pressureSections);
   for(const d of result.decks){
    assert.ok(d.blocks[0].text.length>60);
    assert.ok(d.blocks[0].references.every(r=>['www.nhlbi.nih.gov','www.heart.org'].includes(new URL(r.url).hostname)));
   }
  }
 }
 for(const stage of ['generation','support_review']){
  failure=stage;
  const result=await run('chat');
  assert.equal(result.answer.generation.model,stage==='generation'?groq:workersModels.general);
  assert.match(result.answer.routingNotice,/gemma.*429.*gpt-oss-120b/i);
  assert.ok(result.answer.routingNotice.endsWith(stage==='generation'?'answer generation.':'source review.'));
  assert.equal(result.decks.length,6);
 }
 failure='generation';groqDown=true;
 const snapshot=await run('chat','Show all six decks',0,pressureTopic);
 assert.equal(snapshot.status,'sourced');assert.equal(snapshot.answer.generation,undefined);
 assert.deepEqual(snapshot.decks.map(d=>d.title),pressureSections);
 for(let deck=1;deck<=6;deck++){
  const selected=await run('chat',pressureTopic+' — '+pressureSections[deck-1],deck,pressureTopic);
  assert.equal(selected.answer.blocks[0].text,snapshot.decks[deck-1].blocks[0].text);
  assert.deepEqual(selected.decks,[]);
 }
});

test('the daily blood pressure routine stays scoped to general educational questions',()=>{
 const question='How to manage high blood pressure day to day?';
 assert.ok(asksPressureRoutine(question));
 assert.ok(asksPressureRoutine('How is high blood pressure usually managed day-to-day?'));
 for(const other of ['What causes high blood pressure?', 'How to manage hypertension in pregnancy?',
  'How can I lower my hypertension with chest pain?', 'My blood pressure is 195/125. What should I do?',
  'Compare hypertension and low blood pressure','How can I lower my hypertension with amlodipine?']){
  assert.equal(asksPressureRoutine(other),false,other);
 }
 const body={role:'General',mode:'chat',topic:pressureTopic,searchQuery:question,question:'Show all six decks',deck:0};
 assert.ok(pressureRequest(body));
 for(const override of [{role:'Clinicians'},{attachments:[{}]},{topic:'Leukemia'},{searchQuery:'What is hypertension?'},{question:'What are the symptoms of leukemia?'}]){
  assert.equal(pressureRequest({...body,...override}),false);
 }
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

test('Buddy serves cited local decks for both roles when live literature retrieval stalls',async t=>{
 const nativeTimeout=AbortSignal.timeout;
 const stalled=new Promise(()=>{});
 let liveLookups=0;
 t.mock.method(AbortSignal,'timeout',ms=>nativeTimeout.call(AbortSignal,ms===7000?30:ms));
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  if(url===HF_CHAT_URL && opts.body.includes('deckEvidence'))return new Response(null,{status:503});
  liveLookups++;
  return stalled;
 });
 const config={...env,RETRIEVAL_LIVE:'on',DB:database(1)};
 const catalog={...assets,'/education-sources.json':{text:readFileSync(new URL('../dist/education-sources.json',import.meta.url),'utf8')}};
 for(const role of ['General','Clinicians']){
  const body={role,mode:'chat',deck:0,topic:'Type 2 Diabetes',question:'What is type 2 diabetes?'};
  const result=await (await call(body,config,undefined,undefined,catalog)).json();
  assert.equal(result.status,'sourced');
  assert.ok(result.retrieval.providers.some(p=>p.status==='unavailable'));
  assert.equal(result.decks.length,6);
  assert.ok(result.decks.every(d=>d.blocks.some(b=>b.references?.length)));
 }
 assert.ok(liveLookups>=2);
});

test('a stalled clinical Browser review hands the original draft to Groq once and withholds it if both reviewers stall',async t=>{
 const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);
 let afterDraft=false,expireBackup=false,primaryTimer,reviewTimer,reviewInput;
 const calls=[];
 t.mock.method(AbortSignal,'timeout',ms=>{
  if(afterDraft && (ms===8000 || ms===20000)){
   const timer=new AbortController();
   if(ms===8000)primaryTimer=timer;else reviewTimer=timer;
   return timer.signal;
  }
  return nativeTimeout(ms);
 });
 const stall=timer=>{
  assert.ok(timer,'review timer was installed');
  timer.abort(new DOMException('Simulated slow reviewer','TimeoutError'));
  return new Promise(()=>{});
 };
 const response=(model,data)=>Response.json({model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]});
 const config={...env,DB:database(1),MODEL_PROVIDER:'workers-ai',MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'test-groq',
  AI:{run(model,payload){
   const data=JSON.parse(payload.messages[1].content);
   if(data.claims){calls.push('primary-review');reviewInput=data;return stall(primaryTimer)}
   calls.push('draft');afterDraft=true;
   const source=data.evidence[0];
   return response(model,{answer:[{section:'synthesis',text:source.text.split(/(?<=[.!?])\s+/)[0],sources:[source.id]}]});
  }}};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  const payload=JSON.parse(opts.body),data=JSON.parse(payload.messages[1].content);
  assert.deepEqual(data,reviewInput);calls.push('backup-review');
  if(expireBackup)return stall(reviewTimer);
  return response(payload.model,{checks:data.claims.map(c=>({id:c.id,sources:c.sources,quotes:['@'+c.sources[0]+':1'],verdict:'supported'}))});
 });
 const body={...input,role:'Clinicians',topic:'Prostate Cancer',question:'What is prostate cancer?'};
 for(expireBackup of [false,true]){
  afterDraft=false;primaryTimer=null;reviewTimer=null;
  const result=await(await call(body,config)).json();
  assert.deepEqual(calls.splice(0),['draft','primary-review','backup-review']);
  assert.equal(result.modelFallback.phase,'support_review');assert.equal(result.modelFallback.reason,'timeout');
  if(expireBackup){
   assert.equal(result.status,'sourced');assert.equal(result.code,'model_timeout');
   assert.equal(result.answer.generation,undefined);
  }else{
   assert.equal(result.answer.generation.model,workersModels.professional);
   assert.equal(result.reviewModel,'openai/gpt-oss-120b');
   assert.ok(result.answer.blocks[0].references[0].quote.length>=10);
  }
 }
});

test('Browser retries a broken structured reply once, attributes the failed stage, and stops on refusals',async t=>{
 const groq='openai/gpt-oss-120b', calls=[];
 let badStage,primaryReply,backupReply;
 function completion(model,input){
  const data=JSON.parse(input.messages[1].content);
  const stage=data.claims?'support_review':'generation';
  calls.push([model,stage]);
  if(stage===badStage){
   const makeReply=model===groq?backupReply:primaryReply;
   if(makeReply)return makeReply(model);
  }
  const s=data.evidence?.[0];
  const output=data.claims
   ?{checks:data.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources,...(data.sources[0].sentences?{quotes:[c.text]}:{})}))}
   :{answer:[{text:s.text.split(/(?<=[.!?])\s+/)[0],sources:[s.id],...(data.role==='Medical professional'?{section:'synthesis'}:{})}]};
  return Response.json({model,choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]});
 }
 const cfg={...env,MODEL_PROVIDER:'workers-ai',MODEL_FALLBACK_PROVIDER:'groq',GROQ_API_KEY:'fixture',DB:database(1),AI:{run:completion}};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  const body=JSON.parse(options.body);
  return completion(body.model,body);
 });
 const ask=role=>requestSynthesis({...input,role},input.question,{
  tokenProvider:async()=>'test-token-for-api',
  fetcher:(path,options)=>modelAPI(new Request('https://site.test'+path,options),cfg,assets)
 });
 const truncated=model=>Response.json({model,choices:[{finish_reason:'length',message:{content:'{'}}]});
 const invalid=model=>Response.json({model,choices:[{finish_reason:'stop',message:{content:'{"unexpected":true}'}}]});
 for(const [role,model] of [['General',workersModels.general],['Clinicians',workersModels.professional]]){
  for(badStage of ['generation','support_review']){
   primaryReply=badStage==='generation'?truncated:invalid;backupReply=null;
   const got=await ask(role);
   assert.equal(got.status,'generated');
   assert.equal(got.model,badStage==='generation'?groq:model);
   assert.equal(got.reviewModel,groq);
   assert.equal(got.modelFallback.phase,badStage);
   assert.match(got.answer.routingNotice,/response (was incomplete|format was invalid)/);
   assert.ok(got.answer.blocks.some(b=>b.references?.length));
   assert.deepEqual(calls.splice(0),badStage==='generation'?[[model,'generation'],[groq,'generation'],[groq,'support_review']]:[[model,'generation'],[model,'support_review'],[groq,'support_review']]);
  }
 }
 badStage='generation';primaryReply=()=>new Response('{"choices":');backupReply=invalid;
 const both=await ask('General');
 assert.equal(both.status,'sourced');assert.equal(both.answer.generation,undefined);
 assert.ok(both.answer.blocks.some(b=>b.references?.length));
 assert.equal(both.modelFallback.reason,'provider_output_invalid');
 assert.deepEqual(both.modelFailure,{phase:'generation',model:groq,code:'provider_output_invalid'});
 assert.deepEqual(calls.splice(0),[[workersModels.general,'generation'],[groq,'generation']]);
 for(const [reply,code] of [
  [{choices:[{finish_reason:'content_filter',message:{content:null}}]},'provider_refusal'],
  [{choices:[{finish_reason:'stop',message:{refusal:'declined',content:'{'}}]},'provider_refusal'],
  [{choices:[{finish_reason:'stop',message:{content:'I cannot assist with this request.'}}]},'provider_output_unexpected'],
  [{model:'another-model',choices:[{finish_reason:'stop',message:{content:'{'}}]},'provider_model_mismatch']
 ]){
  primaryReply=()=>Response.json(reply);
  const result=await ask('General');
  assert.equal(result.status,'sourced');assert.equal(result.answer.generation,undefined);
  assert.deepEqual(result.modelFailure,{phase:'generation',model:workersModels.general,code});
  assert.equal(result.modelFallback,undefined);
  assert.deepEqual(calls.splice(0),[[workersModels.general,'generation']]);
 }
});

test('Workers native JSON replies are subject to model, schema and finish checks',()=>{
 const schema={type:'object',required:['answer'],properties:{answer:{type:'string'}}};
 const read=body=>readDeepSeekResult(body,workersModels.general,schema);
 const expected={answer:'ok'};
 for(const response of [expected,JSON.stringify(expected)])assert.deepEqual(read({response}),expected);
 for(const body of [{response:{extra:'x'}},{model:'other',response:expected},{finish_reason:'length',response:expected},
  {finish_reason:'content_filter',response:expected},{choices:[],response:expected}]){
  assert.throws(()=>read(body));
 }
 assert.throws(()=>readDeepSeekResult({response:expected},'openai/gpt-oss-120b',schema));
});
