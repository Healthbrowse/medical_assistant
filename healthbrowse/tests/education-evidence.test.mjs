import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {educationEvidence,addEducation} from '../server/education-evidence.mjs';
import {sourcePassages} from '../server/live-evidence.mjs';
import {prepareCited} from '../server/model-cited.mjs';
const text=readFileSync(new URL('../dist/education-sources.json',import.meta.url),'utf8'),data=JSON.parse(text),assets={'/education-sources.json':{text}};
test('pinned educational corpus retains license, chapter provenance and actual paragraphs',()=>{
 assert.equal(data.license,'CC BY 4.0');assert.equal(data.revision,'b0058a743bdd2cc08196abaaa7d5469970c0d80c');assert.equal(data.modules.length,198);
 assert.ok(data.modules.reduce((n,m)=>n+m.paragraphs.length,0)>4000);
 assert.ok(data.modules.every(m=>/^[a-f0-9]{64}$/.test(m.sha256)&&m.url.includes(data.revision)));
});
test('foundational questions retrieve useful textbook passages without disease-name matching',()=>{
 for(const [question,pattern] of [
  ['Explain the Krebs cycle',/Krebs cycle/],['What is a neuron?',/Neurons are the cells/],
  ['What is the function of the nephron?',/functional units/],['What is the main function of the pituitary gland?',/pituitary/],
  ['How does blood clotting work?',/blood clotting/]
 ]){
  const input={question,topic:question,role:'Medical student',mode:'search',deck:0},sources=educationEvidence(assets,input);
  assert.ok(sources.length,question);assert.ok(sources.some(s=>pattern.test(s.text)),question);
  assert.ok(sources.every(s=>s.attribution.includes('OpenStax')&&s.license==='CC BY 4.0'&&s.sourceType.includes('not a clinical guideline')));
  const prepared=prepareCited(input,addEducation(null,sources,input));assert.ok(prepared.evidence.sources.length);assert.equal(prepared.evidence.domains.length,6);
  assert.equal(JSON.parse(prepared.messages[1].content).question,question);
 }
});
test('educational retrieval rejects unreviewed license revisions and preserves numerical source text',()=>{
 for(const changed of [{...data,license:'CC BY-NC-SA 4.0'},{...data,revision:'main'}])assert.deepEqual(educationEvidence({'/education-sources.json':{text:JSON.stringify(changed)}},{question:'What is a neuron?'}),[]);
 const passage='A normal example measurement is 3.4 units. This sentence preserves its complete source wording.';
 assert.equal(sourcePassages(passage,{url:'https://example.test'})[0].text,passage);
 assert.deepEqual(educationEvidence(assets,{question:'zxqx imaginary biological invention',mode:'search'}),[]);
});
