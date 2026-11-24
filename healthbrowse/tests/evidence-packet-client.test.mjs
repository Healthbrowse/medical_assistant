import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLiteratureEvidence,requestSynthesis} from '../dist/model-client.js';

const gap={query_decomposition:['pituitary gland'],retrieved_sources:[],evidence_gaps:['No qualifying passages.']};
const question={responseMode:'medical',role:'Clinicians',topic:'Pituitary gland',query:'What does the pituitary gland do?'};

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
