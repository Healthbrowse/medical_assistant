import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {educationEvidence,addEducation} from '../server/education-evidence.mjs';
import {learningDecks} from '../server/learning-decks.mjs';
import {citedEvidence,prepareCited,presentCited} from '../server/model-cited.mjs';
const assets=Object.fromEntries(['education-sources','medline-topics','clinical-passages','grounded-sources'].map(name=>['/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}]));
test('bilirubin and pituitary searches use the original educational passages directly in both reading modes',()=>{
 for(const role of ['General reader','Medical professional'])for(const topic of ['bilirubin','pituitary gland']){
  const input={role,topic,question:'What is '+topic+'?',mode:'search',deck:0},rows=educationEvidence(assets,input),local=citedEvidence(assets,input),evidence=learningDecks(addEducation(local,rows,input),input,local);
  assert.equal(evidence.learningMode,true);assert.equal(evidence.deckQuestions,undefined);assert.ok(evidence.sources.some(s=>s.sourceType.includes('foundational medical education')));
  assert.equal(new Set(evidence.sources.map(s=>s.id)).size,evidence.sources.length);
  const p=prepareCited(input,evidence);assert.match(p.messages[0].content,/KNOWLEDGE question/);assert.match(p.messages[0].content,/not describe the substance itself as an illness/);assert.equal(JSON.parse(p.messages[1].content).domains,undefined);assert.deepEqual(Object.keys(p.schema.properties),['answer']);
 }
});
test('disease and document domains remain stable and Buddy stays in depth without repeating decks',()=>{
 const evidence={sources:[{sourceType:'foundational medical education',deck:0,text:'An example.'}]};
 assert.equal(learningDecks(evidence,{question:'What is leukemia?',topic:'Leukemia'}, {sources:[{title:'Leukemia · MedlinePlus'}]}),evidence);assert.equal(learningDecks({...evidence,documentMode:true},{},null).learningMode,undefined);
 const input={role:'General reader',topic:'bilirubin',question:'Explain how the liver processes it.',mode:'chat',deck:2},e=learningDecks(addEducation(null,educationEvidence(assets,{...input,question:'What is bilirubin?'}),input),input,null),p=prepareCited(input,e);
 assert.deepEqual(Object.keys(p.schema.properties),['answer']);assert.match(p.messages[0].content,/2–4 short paragraphs/);
});

test('Buddy keeps diabetes subtypes in disease decks and returns a cited excerpt for each supported section',()=>{
 for(const role of ['General','Clinicians'])for(const topic of ['Type-2 diabetes','Type 2 diabetes','Diabetes Type 2']){
  const input={role,topic,question:'What is '+topic+'?',mode:'chat',deck:0};
  const local=citedEvidence(assets,input);
  const evidence=learningDecks(addEducation(local,educationEvidence(assets,input),input),input,local);
  assert.ok(!evidence.learningMode,topic);
  const prepared=prepareCited(input,evidence);
  const result=presentCited({answer:[],deckClaims:[]},prepared,input,'fixture');
  assert.deepEqual(result.decks.map(d=>d.deck),[1,2,3,4,5,6]);
  for(const deck of result.decks){
   assert.equal(deck.blocks.length,1,topic+' deck '+deck.deck);
   const {text,references:[ref]}=deck.blocks[0];
   assert.ok(evidence.sources.some(s=>s.id===ref.id && s.deck===deck.deck && s.url===ref.url && s.text.includes(text)));
  }
  assert.match(result.decks[5].blocks[0].text,/over time/i);
 }
});

test('education retrieval distinguishes numbered subtypes in a hyphenated disease name',()=>{
 const revision='b0058a743bdd2cc08196abaaa7d5469970c0d80c';
 const paragraphs=[1,2].map(n=>({id:'p'+n,text:'Type '+n+' diabetes is described in this education passage.'}));
 const module={id:'fixture',title:'Medical education',url:'https://github.com/openstax/osbooks-anatomy-physiology/blob/'+revision+'/modules/fixture/index.cnxml',paragraphs};
 const fixture={'/education-sources.json':{text:JSON.stringify({revision,license:'CC BY 4.0',modules:[module]})}};
 const input={question:'What is type-2 diabetes?',mode:'chat',topic:'Type-2 diabetes'};
 const matches=educationEvidence(fixture,input);
 assert.deepEqual([...new Set(matches.map(s=>s.sourceParagraph))],['p2']);
});

test('definition searches keep their subject instead of a disorder alias',async()=>{
 const {educationalSubject}=await import('../dist/query-understanding.js');
 assert.equal(educationalSubject('What is bilirubin?'),'bilirubin');
 assert.equal(educationalSubject('What is the main function of the pituitary gland?'),'pituitary gland');
 assert.equal(educationalSubject('What is leukemia?'),'leukemia');
 assert.equal(educationalSubject('What does the pituitary gland do?'),'pituitary gland');
 assert.equal(educationalSubject('How does the heart work?'),'heart');
 assert.equal(educationalSubject('I have a sore throat'),'');
});

test('learning prompts still leave room for sources on small-context models',async()=>{
 const {compactGeneration,contextCost}=await import('../server/model-context.mjs');
 const input={role:'General reader',topic:'Bilirubin',question:'What is bilirubin?',mode:'search',deck:0},local=citedEvidence(assets,input),e=learningDecks(addEducation(local,educationEvidence(assets,input),input),input,local),p=compactGeneration(input,e);
 assert.ok(p.evidence.sources.length);assert.ok(contextCost(p.messages,p.maxTokens)<=8192);
});
