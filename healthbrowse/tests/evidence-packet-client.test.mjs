import test from 'node:test';
import assert from 'node:assert/strict';
import {createPacketReader} from '../dist/evidence-packet.js';
import {requestLiteratureEvidence,requestSynthesis} from '../dist/model-client.js';

const gap={query_decomposition:['pituitary gland'],retrieved_sources:[],evidence_gaps:['No qualifying passages.']};
const question={responseMode:'medical',role:'Clinicians',topic:'Pituitary gland',query:'What does the pituitary gland do?'};

test('browser and Buddy share concurrent and subsequent reads of a gap-only packet',async()=>{
 let calls=0;
 const reader=createPacketReader(async()=>{calls++;return gap});
 const [browser,buddy]=await Promise.all([reader.read(),reader.read()]);
 assert.deepEqual(browser,gap);assert.equal(buddy,browser);
 assert.equal(await reader.read(),browser);assert.equal(calls,1);
 reader.dispose();
 await assert.rejects(reader.read(),{name:'AbortError'});
});

test('a changed question invalidates an in-flight result and a recoverable failure can be retried',async()=>{
 let deliver;
 const stale=createPacketReader(()=>new Promise(resolve=>{deliver=resolve}));
 const pending=stale.read();
 await Promise.resolve();stale.dispose();deliver(gap);
 await assert.rejects(pending,{name:'AbortError'});
 let attempt=0;
 const retry=createPacketReader(async()=>++attempt===1?{}:gap);
 await assert.rejects(retry.read(),/unavailable/);assert.deepEqual(await retry.read(),gap);
});

test('evidence request uses only a signed-in medical question and the effective reading role',async()=>{
 let calls=0;
 const options={tokenProvider:async()=>'session',fetcher:async(path,init)=>{
  calls++;assert.equal(path,'/api/ai/evidence');assert.equal(init.headers.Authorization,'Bearer session');
  assert.equal(init.cache,'no-store');assert.deepEqual(JSON.parse(init.body),{
   topic:question.topic,question:question.query,role:'Medical professional',mode:'search',deck:0});
  return Response.json(gap);
 }};
 for(const c of [{...question,responseMode:'general'},{...question,attachments:[{text:'document'}]}])
  await assert.rejects(requestLiteratureEvidence(c,options),/medical research question/);
 await assert.rejects(requestLiteratureEvidence(question,{...options,tokenProvider:async()=>null}),/Sign in/);
 assert.equal(calls,0);assert.deepEqual(await requestLiteratureEvidence(question,options),gap);assert.equal(calls,1);
});

test('failed synthesis preserves a completed empty-evidence packet for inspection',async()=>{
 const result=await requestSynthesis(question,question.query,{tokenProvider:async()=>'session',fetcher:async route=>
  route.endsWith('status')?Response.json({}):Response.json({status:'unavailable',code:'evidence_unavailable',retrieval:{evidencePacket:gap}},{status:503})});
 assert.equal(result.status,'unavailable');assert.deepEqual(result.retrieval.evidencePacket,gap);
});
