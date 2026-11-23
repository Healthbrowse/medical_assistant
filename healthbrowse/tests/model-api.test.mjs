import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelAPI,modelStatus,retryDelay} from '../server/model-api.mjs';
import {evidenceFor,validateDraft,reviewPasses,generationMessages} from '../server/model-evidence.mjs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';
import {requestSynthesis,synthesisKey} from '../dist/model-client.js';
import {modelEndpoint,HF_CHAT_URL,GENERAL_MODEL} from '../server/model-provider.mjs';
import {compactGeneration,compactReviews,contextCost,ContextLimit} from '../server/model-context.mjs';
const assets=Object.fromEntries(['medline-topics','clinical-passages'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
const input={topic:'Leukemia',question:'What is leukemia?',role:'General reader',mode:'search',deck:0};
const evidence=evidenceFor(assets,input.topic,input.role,input.question);
function draftFor(e=evidence){
 const source=e.sources[0],text=source.text.slice(0,300);
 return {answer:{claims:[{text,support:[{id:source.id,quote:text}]}]}};
}
function fixture(t,provider){
 const DB=openWorkspace(':memory:');const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url)));
 for(const e of journal.entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));t.after(()=>DB.close());
 const env={RETRIEVAL_LIVE:'off',DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',MODEL_GENERAL_URL:'https://llama.example/v1/chat/completions',MODEL_GENERAL_KEY:'server-secret',MODEL_GENERAL_ID:'llama-adapter',MODEL_PROFESSIONAL_URL:'https://medgemma.example/v1/chat/completions',MODEL_PROFESSIONAL_KEY:'other-server-secret',MODEL_PROFESSIONAL_ID:'medgemma'};
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return opts.headers.Authorization.endsWith('invalid-token')?Response.json({}, {status:401}):Response.json({id:'11111111-1111-4111-8111-111111111111'});
  const b=JSON.parse(opts.body);calls.push({url,body:b,authorization:opts.headers.Authorization});
  if(provider)return provider(b,calls);
  const data=JSON.parse(b.messages[1].content);
  const output=data.draft?{questionAnswered:true,checks:data.draft.answer.claims.map(c=>({id:c.id,verdict:'supported'}))}:draftFor({sources:data.evidence});
  return Response.json({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]});
 });
 const call=(body=input,options={})=>modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(options.token||'valid-token-12345'),...options.headers},body:JSON.stringify(body),signal:options.signal}),env,assets);
 return {call,env,calls,DB};
}
test('legacy search generates and reviews only the directly cited answer',async t=>{
 const {call,calls}=fixture(t);const response=await call();assert.equal(response.status,200);const r=await response.json();
 assert.equal(r.status,'generated');assert.deepEqual(r.decks,[]);assert.equal(calls.length,2);assert.equal(calls[0].body.model,'llama-adapter');
 const generation=JSON.parse(calls[0].body.messages[1].content),review=JSON.parse(calls[1].body.messages[1].content);
 assert.equal(generation.domains,undefined);assert.equal(generation.activeDeck,undefined);
 assert.deepEqual(Object.keys(review.draft),['answer']);
 for(const b of r.answer.blocks){assert.ok(b.references.length);assert.ok(b.references.every(s=>s.text.includes(s.quote)));assert.match(b.verification,/Not independent/)}
 assert.equal(r.answer.checks.length,0,'Do not falsely label paraphrases as exact source matches');
});
test('non-identifying symptom wording reaches the model intact in either reading mode',async t=>{
 const {call,calls}=fixture(t),question='I have a sore throat for three days, what should I do?';
 for(const role of ['General','Clinicians']){
  const r=await (await call({...input,topic:'Sore Throat',question,searchQuery:question,role})).json();
  assert.equal(r.status,'generated');assert.deepEqual(r.decks,[]);
  const generation=calls.at(-2).body;
  assert.equal(JSON.parse(generation.messages[1].content).question,question);
  assert.match(generation.messages[0].content,/No invented citations.*individual diagnosis/);
 }
 const before=calls.length;
 for(const question of ['My patient Jane has a sore throat','I have a sore throat and my name is John','I have a sore throat and cannot breathe'])assert.equal((await call({...input,question})).status,422);
 assert.equal(calls.length,before);
});
test('both model routes accept the two labels and normalize legacy roles',async t=>{
 const {call,calls}=fixture(t);for(const role of ['General','Clinicians','Patient','Medical student','Medical professional','Advanced professional']){const r=await call({...input,role});assert.equal(r.status,200);assert.equal(calls.at(-1).body.model,(['Clinicians','Medical student','Medical professional','Advanced professional'].includes(role))?'medgemma':'llama-adapter')}
 assert.notEqual(generationMessages(input,evidence)[0].content,generationMessages({...input,role:'Medical professional'},evidence)[0].content);
});
test('server owns retrieval and citations and ignores surplus output from old adapters',()=>{
 for(const mutate of [d=>d.answer.claims[0].support[0].id='fake',d=>d.answer.claims[0].support[0].quote='Made-up evidence about an imaginary cure',d=>d.answer.claims[0].support=[],d=>d.answer.claims[0].text='You have leukemia.']){const draft=draftFor();mutate(draft);assert.throws(()=>validateDraft(draft,input,evidence))}
 const old={...draftFor(),decks:[{id:5,claims:[{text:'unsupported'}]}]};
 const valid=validateDraft(old,input,evidence);assert.deepEqual(Object.keys(valid),['answer']);assert.equal(reviewPasses({questionAnswered:true,checks:[]},valid),false);
});
test('failed automated support review triggers one repair then withholds unsafe output',async t=>{
 const {call,calls}=fixture(t,async b=>{const data=JSON.parse(b.messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify(data.draft?{questionAnswered:false,checks:[]}:draftFor())}}]})});
 const r=await call();assert.equal(r.status,502);assert.equal((await r.json()).code,'verification_failed');assert.equal(calls.length,4);assert.match(calls[2].body.messages.at(-1).content,/failed source/);
});
test('one repaired draft can pass but is labeled corrected, not certified',async t=>{
 const {call}=fixture(t,async(b,calls)=>{const data=JSON.parse(b.messages[1].content);let d;
  if(data.draft)d={questionAnswered:true,checks:data.draft.answer.claims.map(c=>({id:c.id,verdict:'supported'}))};
  else{d=draftFor();if(calls.length===1)d.answer.claims[0].support[0].id='invented'}
  return Response.json({choices:[{message:{content:JSON.stringify(d)}}]});});
 const r=await (await call()).json();assert.equal(r.status,'generated');assert.equal(r.corrected,true);
});
test('absence, auth, PHI, body tampering and cross-origin requests never invoke model',async t=>{
 const {call,env,calls}=fixture(t);assert.equal((await call(input,{token:'invalid-token'})).status,401);
 for(const b of [{...input,question:'My name is John Smith and my diagnosis is leukemia'},{...input,history:['patient@example.com']}])assert.equal((await call(b)).status,422);
 assert.equal((await call({...input,evidence:[{text:'fake'}]})).status,400);
 assert.equal((await call(input,{headers:{Origin:'https://attacker.test'}})).status,403);
 delete env.MODEL_GENERAL_KEY;assert.equal((await call()).status,503);assert.equal(modelStatus(env).general.configured,false);assert.equal(calls.length,0);
 assert.doesNotMatch(JSON.stringify(modelStatus(env)),/secret|medgemma.example/);
});
test('real SQL enforces six requests per account per minute',async t=>{
 const {call,DB}=fixture(t);for(let i=0;i<6;i++)assert.equal((await call()).status,200);assert.equal((await call()).status,429);
 const row=await DB.prepare('SELECT * FROM hb_model_limits').bind().first();assert.deepEqual(Object.keys(row).sort(),['bucket','requests','user_id']);assert.equal(row.requests,6);
});
test('provider limits preserve Retry-After without retrying or exposing provider bodies',async t=>{
 const {call,calls}=fixture(t,()=>new Response('private provider diagnostics',{status:429,headers:{'Retry-After':'23'}}));
 const response=await call(),body=await response.json();
 assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'23');
 assert.equal(body.code,'provider_busy');assert.equal(body.retryAfterSeconds,23);assert.equal(calls.length,1);
 assert.doesNotMatch(JSON.stringify(body),/private provider diagnostics|server-secret/);
});
test('Retry-After parser accepts seconds and future dates without inventing a deadline',()=>{
 const now=Date.parse('2026-11-13T12:00:00Z');
 assert.equal(retryDelay('2.2',now),3);assert.equal(retryDelay('Fri, 13 Nov 2026 12:00:20 GMT',now),20);
 for(const value of [null,'','-1','Infinity','garbage','99999999'])assert.equal(retryDelay(value,now),undefined);
});
test('client exposes rate-limit metadata for manual retries in both reading modes',async()=>{
 for(const role of ['General','Clinicians'])for(const seconds of [19,undefined]){
  let calls=0;const before=Date.now();
  const result=await requestSynthesis({...input,role},input.question,{tokenProvider:async()=>'test-token',fetcher:async()=>++calls===1?Response.json({general:{configured:true},professional:{configured:true}}):Response.json({code:'provider_busy',error:'Capacity limit',retryAfterSeconds:seconds},{status:503})});
  assert.equal(calls,2);assert.equal(result.code,'provider_busy');
  if(seconds===undefined)assert.equal(result.retryAt,null);else assert.ok(result.retryAt>=before+19000&&result.retryAt<=Date.now()+19000);
 }
});
test('source-only responses retain the provider retry deadline in all reading modes',async()=>{
 for(const role of ['General','Medical education','Clinicians']){
  let calls=0;const before=Date.now();
  const result=await requestSynthesis({...input,role},input.question,{tokenProvider:async()=>'test-token',fetcher:async()=>++calls===1?Response.json({}):Response.json({status:'sourced',code:'provider_busy',retryAfterSeconds:23,answer:{text:'Retrieved excerpt.'},decks:[]})});
  assert.equal(result.status,'sourced');assert.equal(calls,2);
  assert.ok(result.retryAt>=before+23000&&result.retryAt<=Date.now()+23000);
 }
});
test('buddy sends its own question, search context and active deck; returns no repeated deck array',async t=>{
 const {call,calls}=fixture(t);const r=await (await call({...input,mode:'chat',question:'Explain that further',searchQuery:'What is leukemia?',deck:4,history:['How is it treated?']})).json();
 assert.equal(r.status,'generated');assert.deepEqual(r.decks,[]);assert.equal(r.answer.deck,4);const p=JSON.parse(calls[0].body.messages[1].content);assert.equal(p.browserQuestion,'What is leukemia?');assert.equal(p.priorQuestions[0],'How is it treated?');
});
test('browser can retrieve sources without a configured model and cancels superseded authentication',async()=>{
 let tokens=0;const context={...input,query:input.question};
 const r=await requestSynthesis(context,input.question,{fetcher:async url=>Response.json(url.endsWith('/status')?{general:{configured:false}}:{status:'sourced',answer:{text:'Source excerpt.',blocks:[]},decks:[]}),tokenProvider:async()=>{tokens++;return 'token'}});
 assert.equal(tokens,1);assert.equal(r.status,'sourced');
 const controller=new AbortController();const pending=requestSynthesis(context,input.question,{signal:controller.signal,fetcher:async()=>Response.json({general:{configured:true}}),tokenProvider:()=>new Promise(()=>{})});controller.abort();await assert.rejects(pending);
 assert.notEqual(synthesisKey(context),synthesisKey({...context,role:'Patient'}));assert.notEqual(synthesisKey(context),synthesisKey({...context,query:'How is it treated?'}));
});
test('an unresponsive AI capability check falls back after five seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=requestSynthesis({...input,query:input.question},input.question,{fetcher:()=>new Promise(()=>{})});
 t.mock.timers.tick(5001);
 const result=await pending;assert.equal(result.status,'unavailable');assert.match(result.message,/Source excerpts/);
});

test('HF_TOKEN connects only General to the exact requested hosted model',async t=>{
 const {call,env,calls}=fixture(t);
 for(const k of Object.keys(env))if(k.startsWith('MODEL_'))delete env[k];
 assert.equal(modelStatus(env).general.configured,false);
 env.HF_TOKEN='hf_fixture_only_not_a_real_token';
 assert.equal(modelStatus(env).general.configured,true);
 assert.equal(modelStatus(env).professional.configured,false);
 const result=await (await call()).json();
 assert.equal(result.status,'generated');assert.deepEqual(result.decks,[]);
 assert.equal(result.model,GENERAL_MODEL);
 for(const c of calls){
  assert.equal(c.url,HF_CHAT_URL);assert.equal(c.body.model,GENERAL_MODEL);
  assert.equal(c.authorization,'Bearer '+env.HF_TOKEN);
  assert.ok(contextCost(c.body.messages,c.body.max_tokens)<=8192);
 }
 assert.doesNotMatch(JSON.stringify(modelStatus(env)),/hf_fixture|huggingface/);
 const previous=calls.length;
 assert.equal((await call({...input,role:'Clinicians'})).status,503);
 assert.equal(calls.length,previous);
});

test('HF_TOKEN cannot leak to a custom or clinician endpoint',()=>{
 const env={HF_TOKEN:'sensitive-token',MODEL_GENERAL_URL:'https://another.example/v1/chat/completions',MODEL_GENERAL_ID:'custom'};
 assert.equal(modelEndpoint(env,'general'),null);
 env.MODEL_GENERAL_KEY='dedicated-key';
 assert.equal(modelEndpoint(env,'general').key,'dedicated-key');
 assert.equal(modelEndpoint({...env,MODEL_PROFESSIONAL_URL:HF_CHAT_URL,MODEL_PROFESSIONAL_ID:GENERAL_MODEL},'professional'),null);
 for(const url of ['http://router.huggingface.co/v1/chat/completions','https://router.huggingface.co.evil.test/v1/chat/completions',HF_CHAT_URL+'?key=bad']){
  assert.equal(modelEndpoint({HF_TOKEN:'sensitive-token',MODEL_GENERAL_URL:url},'general'),null);
 }
});

test('short-context retrieval preserves complete passages and checks all claims in bounded reviews',()=>{
 const p=compactGeneration(input,evidence);
 assert.ok(contextCost(p.messages,p.maxTokens)<=8192);
 assert.ok(p.evidence.sources.length>0);
 assert.ok(p.evidence.sources.every(s=>evidence.sources.some(original=>original.id===s.id&&original.text===s.text)));
 const d=validateDraft(draftFor(p.evidence),input,p.evidence),batches=compactReviews(d,p.evidence,input);
 const checked=new Set();
 for(const b of batches){
  assert.ok(contextCost(b.messages,b.maxTokens)<=8192);
  for(const claim of b.draft.answer.claims)checked.add(claim.id);
 }
 assert.deepEqual(checked,new Set(d.answer.claims.map(c=>c.id)));
 assert.throws(()=>compactGeneration({...input,question:'long '.repeat(6000)},evidence),ContextLimit);
});

test('HF buddy shares the model but returns only the requested follow-up',async t=>{
 const {call,env,calls}=fixture(t);
 env.MODEL_GENERAL_URL=HF_CHAT_URL;env.MODEL_GENERAL_ID=GENERAL_MODEL;
 const result=await (await call({...input,mode:'chat',deck:4,question:'Explain treatment options',searchQuery:input.question})).json();
 assert.equal(result.status,'generated');assert.deepEqual(result.decks,[]);
 assert.equal(JSON.parse(calls[0].body.messages[1].content).activeDeck,4);
});

test('provider access errors are specific and are not retried or exposed verbatim',async t=>{
 const {call,calls}=fixture(t,()=>Response.json({error:'internal sensitive provider detail'},{status:401}));
 const r=await call();assert.equal(r.status,503);
 const body=await r.json();assert.equal(body.code,'provider_access');
 assert.equal(calls.length,1);assert.doesNotMatch(JSON.stringify(body),/internal sensitive/);
});

test('DR7 Clinicians use their own endpoint, key and clinical prompts',async t=>{
 const {call,env,calls}=fixture(t);
 env.MODEL_PROFESSIONAL_URL='https://dr7.ai/api/v1/medical/chat/completions';
 env.MODEL_PROFESSIONAL_ID='medgemma-4b-it';env.MODEL_PROFESSIONAL_KEY='dr7-test-fixture';
 const r=await (await call({...input,role:'Clinicians'})).json();
 assert.equal(r.status,'generated');assert.deepEqual(r.decks,[]);
 for(const c of calls){assert.equal(c.url,env.MODEL_PROFESSIONAL_URL);assert.equal(c.body.model,'medgemma-4b-it');assert.equal(c.authorization,'Bearer dr7-test-fixture')}
 assert.match(calls[0].body.messages[0].content,/precise clinical language/);
 const p=JSON.parse(calls[0].body.messages[1].content);assert.equal(p.role,'Medical professional');
 assert.equal((await call({...input,role:'Clinicians',mode:'chat',deck:3,question:'Explain the diagnostic evidence'})).status,200);
});

test('insufficient provider credit produces a useful error without repeat charges',async t=>{
 const {call,calls}=fixture(t,()=>Response.json({error:{code:'insufficient_balance'}},{status:402}));
 const r=await call({...input,role:'Clinicians'});
 assert.equal((await r.json()).code,'provider_credits');assert.equal(calls.length,1);
});

test('compact clinical review fails closed when competing evidence exceeds the review window',()=>{
 const clinical={...input,role:'Clinicians'};
 const sources=Array.from({length:16},(_,i)=>({id:'S'+i,text:('Source passage '+i+'. ').repeat(70)}));
 const draft={answer:{id:0,claims:[{id:'C1',text:'A source-supported statement.',support:[{id:'S0',quote:sources[0].text.slice(0,100)}]}]}};
 assert.throws(()=>compactReviews(draft,{sources},clinical),ContextLimit);
 const [batch]=compactReviews(draft,{sources:sources.slice(0,2)},clinical);
 const payload=JSON.parse(batch.messages[1].content);
 assert.equal(payload.question,input.question);assert.equal(payload.draft.answer.claims[0].id,'C1');
 assert.deepEqual(payload.sources.map(s=>s.id),['S0','S1']);
 assert.ok(contextCost(batch.messages,batch.maxTokens)<=8192);
});

test('client preserves evidence-gap explanations and source retry guidance',async()=>{
 for(const [code,status] of [['no_evidence',200],['evidence_unavailable',503]]){
  let calls=0;const result=await requestSynthesis(input,input.question,{tokenProvider:async()=>'test-token',fetcher:async()=>++calls===1?Response.json({}):Response.json({status:'unavailable',code,error:'Specific source explanation',...(status===503?{retryAfterSeconds:15}:{})},{status})});
  assert.equal(result.message,'Specific source explanation');assert.equal(result.code,code);if(status===503)assert.ok(result.retryAt>Date.now());
 }
});
test('dedicated base reviewer receives review prompts while adapter receives generation prompts',async t=>{
 const {call,env,calls}=fixture(t);env.MODEL_GENERAL_REVIEW_ID='base-review';
 const r=await call();assert.equal(r.status,200);
 assert.equal(calls[0].body.model,'llama-adapter');assert.equal(calls[1].body.model,'base-review');
 assert.ok(JSON.parse(calls[1].body.messages[1].content).draft);
 env.MODEL_GENERAL_REVIEW_URL='https://other-reviewer.example/v1/chat/completions';
 const count=calls.length;const failed=await call();assert.equal(failed.status,503);assert.equal((await failed.json()).code,'reviewer_not_configured');assert.equal(calls.length,count);
});
