import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchAnswer} from '../dist/search-experience.js';
import {definitionScore} from '../dist/answer-relevance.js';
import {medlineIndex} from '../dist/medline.js';
import {medlinePassages} from '../dist/disease-framework.js';
import {educationEvidence,addEducation} from '../server/education-evidence.mjs';
import {learningDecks} from '../server/learning-decks.mjs';
import {citedEvidence,prepareCited,presentCited} from '../server/model-cited.mjs';
const assets=Object.fromEntries(['education-sources','medline-topics','clinical-passages','grounded-sources'].map(n=>['/'+n+'.json',{text:readFileSync(new URL('../dist/'+n+'.json',import.meta.url),'utf8')}]));
const feed=JSON.parse(assets['/medline-topics.json'].text),index=medlineIndex(feed);
test('the reported mitochondria question immediately answers the organelle in both modes',()=>{
 for(const role of ['General reader','Medical professional']){
  const topic='Mitochondria',passages=medlinePassages(index.find(topic),topic,feed),r=searchAnswer({topic,role,passages},'What is mitochondria?');
  assert.equal(r.supported,true);assert.match(r.blocks[0].text,/^Mitochondria are small structures that produce energy/);
  assert.doesNotMatch(r.text,/Metabolism is the process|Genetic mutations cause|no cures|vitamins|physical therapy/);
  assert.equal(r.blocks.length,1);assert.ok(r.citations.length);assert.ok(r.blocks[0].check.text.includes(r.blocks[0].text));
 }
});
test('definitions survive evidence budgeting and provider-unavailable fallbacks',()=>{
 for(const role of ['General reader','Medical professional'])for(const [topic,pattern] of [['Mitochondria',/^A mitochondrion/],['Pituitary gland',/pituitary/i],['Bilirubin',/bilirubin/i]]){
  const input={topic,question:'What is '+topic+'?',role,mode:'search',deck:0};
  const local=citedEvidence(assets,input),e=learningDecks(addEducation(local,educationEvidence(assets,input),input),input,local),p=prepareCited(input,e);
  assert.ok(p.evidence.sources.some(s=>definitionScore(s,input.question,topic)>0));
  const r=presentCited({answer:[]},p,input,'');assert.match(r.answer.blocks[0].text,pattern);
  assert.deepEqual(r.decks,[]);assert.ok(r.learningMode);assert.ok(r.answer.blocks[0].citation.text.includes(r.answer.blocks[0].text));
  if(topic==='Mitochondria'){assert.match(p.evidence.sources[0].text,/^A mitochondrion/);assert.doesNotMatch(r.answer.text,/Slow fibers|Genetic mutations cause|Metabolism is the process/)}
 }
});
test('incidental word overlap is not a definition and missing definitions stay explicit',()=>{
 const q='What is mitochondria?',topic='Mitochondria';
 for(const text of ['It depends on how many mitochondria are defective.','Metabolism is the process your body uses to make energy.','Exercise can produce more mitochondria.'])assert.equal(definitionScore({text},q,topic),0);
 const evidence={sources:[{id:'S1',deck:0,overview:true,text:'Exercise can produce more mitochondria.',url:'https://example.test'}],style:'',domains:[]};
 const r=presentCited({answer:[]},{evidence},{question:q,topic,mode:'search',role:'Medical professional'},'');assert.equal(r.answer.blocks.length,0);assert.match(r.answer.text,/Insufficient/);
});

test('direct clinical answers retain exact education passage IDs across support review',async()=>{
 const {prepareCitedReview,applyCitedReview}=await import('../server/model-cited.mjs');
 const input={topic:'Mitochondria',question:'What is mitochondria?',role:'Medical professional',mode:'search'};
 const text='Mitochondria are cell structures that convert nutrients into usable cellular energy.';
 const evidence={sources:[
  {id:'S1',deck:0,overview:true,url:'https://example.test/source',text},
  {id:'S2',deck:1,overview:false,url:'https://example.test/source',text},
  {id:'S3',deck:2,overview:false,url:'https://example.test/other',text:'A different passage about the topic.'}
 ]};
 const p={evidence},raw={answer:[{text,sources:['S1'],section:'synthesis'}]};
 const review=prepareCitedReview(raw,p,input);assert.equal(review.claims.length,1);
 assert.deepEqual(review.claims[0].sources,['S1']);assert.equal(review.claims[0].text,text);
 const decide=(verdict,sources,quotes)=>applyCitedReview({checks:[{id:'C1',verdict,sources,quotes}]},review,p,input);
 const result=presentCited(decide('supported',['S1'],[text]),p,input,'test');
 assert.deepEqual(result.decks,[]);
 assert.deepEqual(result.answer.blocks.map(b=>[b.section,b.citation.id,b.citation.quote]),[['synthesis','S1',text]]);
 assert.deepEqual(decide('unsupported',[],[]).answer,[],'Exact citation identity never bypasses support review');
 assert.deepEqual(decide('supported',['S3'],[text]).answer,[],'A quote from another source fails verification');
});
