import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {citedEvidence,prepareCited,presentCited,prepareCitedReview,applyCitedReview} from '../server/model-cited.mjs';
import {modelAPI,modelStatus} from '../server/model-api.mjs';
import {modelEndpoint,GROQ_CHAT_URL} from '../server/model-provider.mjs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(n=>['/'+n+'.json',{text:readFileSync(new URL('../dist/'+n+'.json',import.meta.url),'utf8')}]));
const input={topic:'Leukemia',question:'What is leukemia?',role:'General reader',mode:'search',deck:0};
const prepared=prepareCited(input,citedEvidence(assets,input));
function rawFor(p=prepared){
 const source=p.evidence.sources.find(s=>s.overview)||p.evidence.sources[0];
 const text=source.text.match(/^.*?[.!?](?:\s|$)/)?.[0].trim()||source.text+'.';
 return {answer:[{text,sources:[source.id]}]};
}
test('Groq uses only its own key and a fixed endpoint for both reading modes',()=>{
 const env={MODEL_PROVIDER:'groq',HF_TOKEN:'must-not-leak',MODEL_PROFESSIONAL_KEY:'must-not-leak'};
 assert.equal(modelEndpoint(env,'general'),null);assert.equal(modelEndpoint(env,'professional'),null);
 env.GROQ_API_KEY='test-only';
 for(const route of ['general','professional']){const c=modelEndpoint(env,route);assert.equal(c.url,GROQ_CHAT_URL);assert.equal(c.key,'test-only');assert.equal(c.model,'openai/gpt-oss-120b');}
 assert.equal(modelEndpoint({...env,GROQ_MODEL:'unverified'},'general'),null);
 assert.doesNotMatch(JSON.stringify(modelStatus(env)),/test-only|must-not-leak/);
});
test('both search audiences request a direct cited answer with no six-domain assignment',()=>{
 for(const role of ['General','Clinicians'])for(const topic of ['Leukemia','Sore Throat','Cold Sores']){
  const question={...input,topic,role,question:'What is '+topic.toLowerCase()+'?'};
  const p=prepareCited(question,citedEvidence(assets,question));
  const payload=JSON.parse(p.messages[1].content);
  assert.deepEqual(Object.keys(p.schema.properties),['answer']);
  assert.deepEqual(p.schema.required,['answer']);
  assert.equal(p.schema.additionalProperties,false);
  assert.equal(!!p.schema.properties.answer.items.properties.section,role==='Clinicians');
  assert.doesNotMatch(p.messages[0].content,/six (?:medical |clinical |learning )?(?:decks|domains)|FAQ order/i);
  assert.equal(payload.domains,undefined);
  assert.ok(payload.evidence.length>0);
  assert.ok(p.evidence.sources.every(s=>!s.historical));
  assert.ok(JSON.stringify(p.messages).length<18000);
  assert.doesNotMatch(JSON.stringify(p.schema),/maxLength/,'Schema must not truncate sentences');
 }
});
test('an invalid citation leaves independently verified answer claims intact',()=>{
 const raw=rawFor();
 raw.answer.push({text:'An invented statement about the condition.',sources:['FAKE']});
 const check=prepareCitedReview(raw,prepared,input);
 assert.equal(check.claims.length,1);
 const checks=check.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources}));
 const r=presentCited(applyCitedReview({checks},check,prepared,input),prepared,input,'test');
 assert.deepEqual(r.decks,[]);assert.equal(r.answer.blocks.length,1);assert.ok(r.answer.generation);
 assert.equal(r.validation.withheldClaims,1);
 const [block]=r.answer.blocks;
 assert.ok(block.references.every(ref=>ref.text===ref.quote));
 assert.doesNotMatch(block.verification,/review passed|certified/);
 assert.doesNotMatch(r.answer.text,/invented statement/);
});
test('unfinished sentences, doses, personal diagnoses and omitted subtype qualifiers are withheld',()=>{
 const scoped={id:'S1',text:'The source discusses bleeding specifically in acute myeloid leukemia.',scopeTerms:['AML']};
 const p={...prepared,evidence:{...prepared.evidence,sources:[scoped]}};
 for(const claim of [
  {text:'Leukemia causes bleeding.',sources:[scoped.id]},
  {text:'AML treatment includes.',sources:[scoped.id]},
  {text:'Take 20 mg daily for AML.',sources:[scoped.id]},
  {text:'You have AML.',sources:[scoped.id]},
 ]){const check=prepareCitedReview({answer:[claim]},p,input);assert.equal(check.claims.length,0);}
});
test('a search without supporting passages reports a direct-answer gap',()=>{
 const p={...prepared,evidence:{...prepared.evidence,sources:[]}};
 const r=presentCited({answer:[]},p,input,'test');assert.deepEqual(r.decks,[]);
 assert.equal(r.answer.blocks.length,0);assert.match(r.answer.text,/insufficient/i);
});
test('Buddy and browser reviews must cover every claim and select known sources',()=>{
 for(const mode of ['chat','search']){
  const query={...input,mode,deck:mode==='chat'?1:0};
  const p=prepareCited(query,citedEvidence(assets,query));
  assert.deepEqual(Object.keys(p.schema.properties),['answer']);
  const check=prepareCitedReview(rawFor(p),p,query);
  assert.equal(applyCitedReview({checks:[]},check,p,query).answer.length,0);
  const [claim]=check.claims;
  const review=sources=>({checks:[{id:claim.id,verdict:'supported',sources}]});
  assert.equal(applyCitedReview(review(['invented']),check,p,query).answer.length,0);
  assert.equal(applyCitedReview(review(claim.sources),check,p,query).answer.length,1);
 }
});
test('both modes and Buddy generate once and review support once through the API contract',async t=>{
 const DB=openWorkspace(':memory:');t.after(()=>DB.close());
 for(const e of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url))).entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
 const env={RETRIEVAL_LIVE:'off',DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',MODEL_PROVIDER:'groq',GROQ_API_KEY:'test-only'};
 const calls=[];let providerStatus=200;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,GROQ_CHAT_URL);assert.equal(opts.headers.Authorization,'Bearer test-only');
  const body=JSON.parse(opts.body);calls.push(body);if(providerStatus!==200)return Response.json({}, {status:providerStatus});
  const p=JSON.parse(body.messages[1].content);
  if(p.claims)return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({checks:p.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources}))})}}]});
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(rawFor({evidence:{sources:p.evidence}}))}}]});
 });
 const call=b=>modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-session-12345'},body:JSON.stringify(b)}),env,assets);
 for(const role of ['General','Clinicians']){const r=await (await call({...input,role})).json();assert.equal(r.status,'generated');assert.deepEqual(r.decks,[]);}
 assert.equal(calls.length,4);assert.notEqual(calls[0].messages[0].content,calls[2].messages[0].content);
 assert.equal(calls[0].response_format.type,'json_schema');assert.equal(calls[0].reasoning_effort,'low');assert.equal(calls[0].include_reasoning,false);
 const chat={...input,mode:'chat',deck:4,question:'Explain that further',searchQuery:input.question,history:['What treatments are used?'],browserContext:'Current deck: treatment depends on the leukemia subtype.'};
 const r=await (await call(chat)).json();assert.deepEqual(r.decks,[]);assert.equal(calls.length,6);
 assert.equal(JSON.parse(calls[4].messages[1].content).browserContext,chat.browserContext);
 assert.equal((await call({...chat,browserContext:'x'.repeat(1201)})).status,400);
 providerStatus=429;const busy=await call(input);assert.equal((await busy.json()).code,'provider_busy');assert.equal(calls.length,7,'No repeated billable retries');
 delete env.GROQ_API_KEY;assert.equal((await call(input)).status,503);assert.equal(calls.length,7);
});

test('old deck-only content cannot enter direct answers or the support review',()=>{
 const valid=rawFor().answer[0];
 const obsolete={text:'An obsolete deck statement.',sources:valid.sources};
 for(const answer of [[],[valid]]){
  const raw={answer,decks:{1:[obsolete]}};
  const check=prepareCitedReview(raw,prepared,input);
  assert.equal(check.claims.length,answer.length);
  assert.doesNotMatch(check.messages[1].content,/obsolete deck statement/);
  const checks=check.claims.map(c=>({id:c.id,verdict:'unsupported',sources:[]}));
  const reviewed=applyCitedReview({checks},check,prepared,input);
  assert.deepEqual(reviewed.answer,[]);
  const shown=presentCited(reviewed,prepared,input,'test');
  assert.deepEqual(shown.decks,[]);
  assert.doesNotMatch(shown.answer.text,/obsolete deck statement/);
  assert.equal(shown.answer.generation,undefined);
 }
});
test('diagnosis lead survives the complete API and client path for browser, Buddy and older renderers',async t=>{
 const {requestSynthesis}=await import('../dist/model-client.js');
 const DB=openWorkspace(':memory:');t.after(()=>DB.close());
 for(const e of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url))).entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
 const env={RETRIEVAL_LIVE:'off',DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',MODEL_PROVIDER:'groq',GROQ_API_KEY:'test-only'};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,GROQ_CHAT_URL);const data=JSON.parse(JSON.parse(opts.body).messages[1].content);
  const output=data.claims?{checks:data.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources}))}:rawFor({evidence:{sources:data.evidence}});
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
 });
 const fetcher=(url,options={})=>modelAPI(new Request('https://site.test'+url,options),env,assets);
 for(const role of ['General','Clinicians'])for(const mode of ['search','chat']){
  const question=mode==='search'?'I have a fever of 102 and pain in joints. Do I have dengue fever?':'I have fever and joint pain. Is it dengue?';
  const r=await requestSynthesis({topic:'Dengue',role,query:question},question,{mode,fetcher,tokenProvider:async()=>'test-session-12345'});
  assert.equal(r.status,'generated');assert.match(r.answer.blocks[0].text,/cannot be confirmed|can't confirm/);
  assert.match(r.answer.blocks[0].text,/blood tests?/i);assert.equal(r.answer.followUpQuestions.length,3);
  if(role==='Clinicians')assert.ok(r.answer.diagnosisReferences.every(ref=>/^S\d+$/.test(ref.id)&&ref.quote));
  assert.deepEqual(r.decks,[]);
  const legacyText=r.answer.blocks.map(b=>b.text).join('\n');
  assert.ok(legacyText.startsWith(r.answer.diagnosisNotice));assert.ok(legacyText.includes(r.answer.followUpQuestions[0]));
 }
});

test('pituitary search and Buddy complete the authenticated API contract for both audiences',async t=>{
 const DB=openWorkspace(':memory:');t.after(()=>DB.close());
 for(const e of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url))).entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
 const env={RETRIEVAL_LIVE:'off',DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',MODEL_PROVIDER:'groq',GROQ_API_KEY:'test-only'};
 let providerCalls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(url,GROQ_CHAT_URL);providerCalls++;
  const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);
  let raw;
  if(data.claims)raw={checks:data.claims.map(c=>({id:c.id,verdict:'supported',sources:c.sources}))};
  else{
   assert.equal(data.topic,'Pituitary gland');assert.match(data.question,/main function|What does it do/);
   const source=data.evidence.find(s=>s.text.includes('hormones that affect growth'));assert.ok(source);
   raw={answer:[{text:source.text,sources:[source.id]}]};
  }
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
 });
 for(const role of ['General','Clinicians'])for(const mode of ['search','chat']){
  const question=mode==='search'?'What is the main function of the pituitary gland?':'What does it do?';
  const response=await modelAPI(new Request('https://site.test/api/ai/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-session-12345'},body:JSON.stringify({topic:'Pituitary gland',question,searchQuery:'What is the main function of the pituitary gland?',role,mode,deck:2})}),env,assets);
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'generated');assert.deepEqual(data.decks,[]);
  assert.match(data.answer.blocks[0].text,/hormones that affect growth/);assert.equal(data.answer.blocks[0].references[0].url,'https://medlineplus.gov/pituitarydisorders.html');
 }
 assert.equal(providerCalls,8,'One generation and one support review per request.');
});

test('General question guidance reaches both provider protocols in search and Buddy',async()=>{
 const {generationMessages}=await import('../server/model-evidence.mjs');
 const question='My daughter has a sore throat. What could cause it and what should I do?';
 for(const mode of ['search','chat']){
  const general={...input,topic:'Sore Throat',question,mode};
  const evidence=citedEvidence(assets,general);
  for(const messages of [(q)=>prepareCited(q,evidence).messages,(q)=>generationMessages(q,evidence)]){
   const prompt=messages(general)[0].content;
   for(const cue of ['Distinguish the person asking','possible cause from a confirmed cause','next step supported']){
    assert.ok(prompt.includes(cue),cue);
    assert.ok(!messages({...general,role:'Clinicians'})[0].content.includes(cue),cue);
    assert.ok(!messages({...general,question:'What is leukemia?'})[0].content.includes(cue),cue);
   }
   assert.ok(!prompt.includes(question),'User text stays out of system instructions');
  }
 }
});
