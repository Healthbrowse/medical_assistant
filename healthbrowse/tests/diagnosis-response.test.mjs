import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {personalDiagnosisNotice} from '../dist/safety-policy.js';
import {applyDiagnosisResponse,hasUnstatedTemperatureUnit} from '../dist/diagnosis-response.js';
import {searchAnswer} from '../dist/search-experience.js';
import {renderAnswer} from '../dist/answer-view.js';
import {citedEvidence,prepareCited,prepareCitedReview,presentCited} from '../server/model-cited.mjs';
import {generationMessages,validateDraft,presentDraft} from '../server/model-evidence.mjs';
const question='I have a fever of 102 and pain in joints. Do I have dengue fever?';
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(n=>['/'+n+'.json',{text:readFileSync(new URL('../dist/'+n+'.json',import.meta.url),'utf8')}]));
const input={topic:'Dengue',question,role:'General reader',mode:'search',deck:0};
test('ordinary confirmation questions are recognized without blocking education or account questions',()=>{
 for(const q of [question,'Do I have dengue?','Could I have dengue?','Do I definitely have leukemia?','Diagnose me','Could my child have dengue?'])assert.ok(personalDiagnosisNotice(q),q);
 for(const q of ['What is dengue?','How is dengue diagnosed?','Do I have to get tested?','Do I have an account?','Do I have access to chat?'])assert.equal(personalDiagnosisNotice(q),undefined,q);
});
test('natural confirmation wording reaches the same answer without requiring exact terminology',()=>{
 const questions=[
  'I have fever and joint pain. Is it dengue?',
  'I have a fever of 102 and pain in joints. Is this dengue fever?',
  'I have fever and joint pain. Could this be dengue?',
  'I have fever and joint pain. Do you think it is dengue?',
  'I have fever and joint pain. What could it be?',
  'Is it dengue?',
 ];
 for(const question of questions){
  assert.ok(personalDiagnosisNotice(question,'Dengue'),question);
  const r=searchAnswer({topic:'Dengue',role:'General reader',passages:[]},question);
  assert.equal(r.blocks[0].text,r.diagnosisNotice,question);
  assert.ok(r.blocks.at(-1).text.includes(r.followUpQuestions[0]),question);
 }
 assert.ok(personalDiagnosisNotice('Is it lupus?','Lupus'),'No fixed disease vocabulary');
 for(const q of ['Is this website safe?','What is dengue?','Is dengue caused by a virus?','Could a blood test detect dengue?','Do I have an appointment?'])assert.equal(personalDiagnosisNotice(q,'Dengue'),undefined,q);
});
test('ordinary answer blocks preserve the opening and follow-ups for older open clients',()=>{
 const r=searchAnswer({topic:'Dengue',role:'General reader',passages:[]},question);
 const olderClientText=r.blocks.map(b=>b.text).join('\n\n');
 assert.ok(olderClientText.startsWith("I can't confirm whether you have dengue"));
 for(const q of r.followUpQuestions)assert.ok(olderClientText.includes(q));
 assert.match(olderClientText,/mosquito bites/);assert.match(olderClientText,/urgent medical care/);
});
test('General browser and Buddy fallback answer the reported question before asking three relevant questions',()=>{
 const role='General reader';
 {
  const r=searchAnswer({topic:'Dengue',role,passages:[]},question);
  assert.ok(r.text.startsWith(r.diagnosisNotice));assert.match(r.diagnosisNotice,/blood tests/);
  assert.equal(r.blocks[0].text,r.diagnosisNotice);assert.match(r.blocks[1].text,/other (?:illnesses|febrile illnesses)/i);
  assert.equal(r.followUpQuestions.length,3);assert.match(r.followUpQuestions[0],/How long.*°F or °C/);
  assert.match(r.followUpQuestions[1],role==='General reader'?/pain behind your eyes/:/retro-orbital/);
  assert.match(r.followUpQuestions[2],/assessment or tests/);assert.match(r.careAdvice.text,/Do not wait for test results/);
  assert.ok(r.citations.every(c=>new URL(c.url).hostname==='www.cdc.gov'));
  assert.doesNotMatch(r.text,/102\s*°?\s*F|confirm you have|you have dengue\./i);
  assert.equal(applyDiagnosisResponse(r,{...input,question:'What is dengue?'}),r);
 }
});
test('without retrieved passages a clinician diagnosis response asks for missing data without inventing testing advice, symptoms or CDC IDs',()=>{
 const r=searchAnswer({topic:'Dengue',role:'Medical professional',passages:[]},question);
 assert.match(r.diagnosisNotice,/confirm a diagnosis from symptoms alone/);
 assert.deepEqual(r.citations,[]);
 assert.equal(r.followUpQuestions.length,3);
 assert.match(r.followUpQuestions[0],/°F or °C/);
 assert.doesNotMatch(r.text,/blood tests?|retro-orbital|platelets|CDC-|assess you and choose/i);
 assert.ok(!r.careAdvice);
});
test('clinician responses use the exact retrieved dengue testing sentence with its supplied identifier',()=>{
 const r=applyDiagnosisResponse({blocks:[],citations:[]},{...input,role:'Medical professional'},
  {sources:[{id:'Source_7',title:'Dengue',url:'https://medlineplus.gov/dengue.html',text:'There is a blood test which can show if you have been infected with dengue.'}]});
 assert.deepEqual(r.diagnosisReferences.map(s=>s.id),['Source_7']);
 assert.ok(r.diagnosisNotice.endsWith(r.diagnosisReferences[0].quote));
 assert.match(r.text,/\[Source_7\]/);
});
test('generated answers and provider fallback retain the same leading contract in both routes and roles',()=>{
 for(const role of ['General reader','Medical professional'])for(const mode of ['search','chat']){
  const i={...input,role,mode},p=prepareCited(i,citedEvidence(assets,i)),s=p.evidence.sources[0];
  const text='Dengue may cause fever and joint pain.';
  for(const raw of [{answer:[{text,sources:[s.id]}],decks:{}},{answer:[],decks:{}}]){
   const r=presentCited(raw,p,i,'test-fixture').answer;
   assert.ok(r.text.startsWith(r.diagnosisNotice));assert.equal(r.followUpQuestions.length,3);assert.ok(r.diagnosisReferences.length);
  }
  const r=presentDraft({answer:{claims:[{text,support:[{id:s.id,quote:s.text}]}]},decks:[]},p.evidence,i,'test-fixture',false).answer;
  assert.ok(r.text.startsWith(r.diagnosisNotice));assert.equal(r.followUpQuestions.length,3);
  assert.match(generationMessages(i,p.evidence)[0].content,/Do not assume missing temperature units/);
  assert.match(p.messages[0].content,/Give only 1–2 short explanatory paragraphs/);
 }
});
test('missing temperature units cannot be silently introduced by either model response route',()=>{
 assert.equal(hasUnstatedTemperatureUnit(question,'A fever of 102 °F is present.'),true);
 assert.equal(hasUnstatedTemperatureUnit(question,'The reported temperature is 102.'),false);
 assert.equal(hasUnstatedTemperatureUnit(question.replace('102','102 F'),'The reported temperature is 102 °F.'),false);
 const p=prepareCited(input,citedEvidence(assets,input)),s=p.evidence.sources[0];
 const bad='A fever of 102 °F and joint pain match dengue symptoms.';
 assert.equal(prepareCitedReview({answer:[{text:bad,sources:[s.id]}],decks:{}},p,input).claims.length,0);
 assert.doesNotMatch(presentCited({answer:[{text:bad,sources:[s.id]}],decks:{}},p,input,'test').answer.text,/102 °F/);
 assert.throws(()=>validateDraft({answer:{claims:[{text:bad,support:[{id:s.id,quote:s.text.slice(0,100)}]}]},decks:[]},{...input,mode:'chat'},p.evidence),/Invalid/);
});
test('a thin generated testing answer still receives a short dengue explanation',()=>{
 const ref={id:'S9',url:'https://medlineplus.gov/dengue.html',title:'Dengue · MedlinePlus'};
 const r=applyDiagnosisResponse({blocks:[{text:'Blood tests are used to confirm dengue infection.',references:[ref]}],citations:[ref]},input);
 assert.equal(r.blocks.length,5);assert.match(r.blocks[1].text,/mosquito bites/);assert.match(r.blocks[2].text,/Blood tests/);
 assert.ok(r.blocks[1].references.every(c=>c.url.startsWith('https://www.cdc.gov/')));
 assert.equal(applyDiagnosisResponse(r,input).blocks.length,5,'Enrichment is not duplicated');
});
class Node{constructor(tag){this.tag=tag;this.children=[];this.textContent=''}append(...items){this.children.push(...items)}setAttribute(){}addEventListener(){}}
test('the rendered first paragraph is uncertainty, then explanation, safety advice and questions',t=>{
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>{globalThis.document=previous});
 const r=searchAnswer({topic:'Dengue',role:'General reader',passages:[]},question),root=new Node('div');renderAnswer(root,r);
 assert.equal(root.children[0].className,'diagnosis-lead');assert.equal(root.children[0].textContent,r.diagnosisNotice);
 assert.equal(root.children[1].className,'answer-block');
 const follow=root.children.findIndex(n=>n.className==='symptom-follow-up'),care=root.children.findIndex(n=>n.className==='care-next-step');
 assert.ok(follow>care&&care>1);assert.equal(root.children[follow].children[1].children.length,3);
 assert.equal(root.children.filter(n=>n.textContent===r.diagnosisNotice).length,1);
});
