import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newSubjects} from '../dist/topic-scope.js';
import {topicIndex} from '../dist/discovery.js';
import {medlineIndex} from '../dist/medline.js';
import {createMedicalRetrieval} from '../dist/medical-retrieval.js';
import {medlinePassages} from '../dist/disease-framework.js';
import {searchAnswer,domainAnswer} from '../dist/search-experience.js';
import {citedEvidence,prepareCited} from '../server/model-cited.mjs';
const read=name=>readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8');
const feed=JSON.parse(read('medline-topics')),index=medlineIndex(feed);
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(n=>['/'+n+'.json',{text:read(n)}]));
test('pituitary physiology resolves from source text without renaming the gland as a tumor',()=>{
 for(const query of ['What is the main function of the pituitary gland?','What does the pituitary gland do?','Can you explain the function of the pituitary gland?']){
  const result=index.resolveQuestion(query);assert.equal(result.topic,'Pituitary gland');assert.equal(result.record.url,'https://medlineplus.gov/pituitarydisorders.html');
  for(const role of ['General reader','Medical professional']){
   const context={topic:result.topic,role,passages:medlinePassages(result.record,result.topic,feed),records:[]};
   const answer=searchAnswer(context,query);assert.equal(answer.supported,true);assert.match(answer.blocks[0].text,/hormones that affect growth/);assert.equal(answer.blocks[0].citation.url,result.record.url);
   for(const followup of ['What does it do?','How does it work?'])assert.equal(searchAnswer(context,followup,{detail:true,activeDeck:2}).supported,true);
   for(let deck=1;deck<=6;deck++){const response=domainAnswer(context,deck);assert.ok(response.text);assert.ok(response.supported?response.citations.length:response.gaps.length)}
  }
 }
});
test('ordinary organ and hormone function questions have cited fallback answers without an AI provider',()=>{
 for(const subject of ['kidneys','pancreas','spleen','heart','insulin','hemoglobin']){
  const query='What is the function of the '+subject+'?',result=index.resolveQuestion(query);assert.ok(result,query);
  const response=searchAnswer({topic:result.topic,role:'General reader',passages:medlinePassages(result.record,result.topic,feed),records:[]},query);
  assert.equal(response.supported,true,query);assert.ok(response.blocks.every(b=>b.citation.url.startsWith('https://medlineplus.gov/')));
 }
});
test('retrieval does not combine terms across unrelated paragraphs, use external text, or guess unknown subjects',()=>{
 const retrieval=createMedicalRetrieval({topics:[{title:'Example',url:'https://medlineplus.gov/example.html',knowledge:[{text:'Alpha gland secretes hormones.'},{text:'Beta organ filters blood.'}]},{title:'Injected',url:'https://untrusted.example',knowledge:[{text:'Alpha gland beta organ.'}]}]});
 assert.equal(retrieval.resolve('alpha beta'),null);
 for(const query of ['What does it do?','What is the function?','gland','zzzx imaginary organ'])assert.equal(index.resolveQuestion(query),null,query);
 const ambiguous=medlineIndex({topics:[{title:'one',aliases:['xx']},{title:'two',aliases:['xx']}]});assert.equal(ambiguous.find('xx'),null);
});
test('both generation paths receive server-owned pituitary evidence and the exact question',()=>{
 for(const role of ['General reader','Medical professional'])for(const mode of ['search','chat']){
  const input={topic:'Pituitary gland',question:'What is the main function of the pituitary gland?',searchQuery:'Pituitary gland',role,mode,deck:2};
  const evidence=citedEvidence(assets,input);assert.ok(evidence.sources.some(s=>s.text.includes('hormones that affect growth')));
  const p=prepareCited(input,evidence),data=JSON.parse(p.messages[1].content);assert.equal(data.question,input.question);assert.equal(data.topic,'Pituitary gland');assert.equal(data.role,role);assert.match(p.messages[0].content,/normal function first/);
  assert.ok(p.evidence.sources.every(s=>s.url.startsWith('https://medlineplus.gov/')));
 }
});

test('Buddy offers a topic switch for a new organ but keeps pronoun follow-ups in the active context',()=>{
 const terms=topicIndex(feed.topics.map(t=>({name:t.title,aliases:t.aliases||[]})));
 assert.deepEqual(newSubjects('What is the function of the pituitary gland?',terms,'Leukemia',index),['Pituitary gland']);
 assert.deepEqual(newSubjects('What is the function of the pituitary gland?',terms,'Pituitary gland',index),[]);
 assert.deepEqual(newSubjects('What does it do?',terms,'Pituitary gland',index),[]);
});
