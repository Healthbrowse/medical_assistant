import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {educationEvidence,addEducation} from '../server/education-evidence.mjs';
import {learningDecks} from '../server/learning-decks.mjs';
import {citedEvidence,prepareCited} from '../server/model-cited.mjs';
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
