import test from 'node:test';
import assert from 'node:assert/strict';
import {faqQuestions,faqPassages,generalTreatmentNotice} from '../dist/faq-spec.js';
import {answerReferences,answerMarkdown} from '../dist/answer-export.js';
import {buddyLearningQuestions} from '../dist/learning-questions.js';
import {domainAnswer} from '../dist/search-experience.js';
import {presentDraft} from '../server/model-evidence.mjs';
import {sessionIdFromVerifiedAccessToken} from '../server/auth-session.mjs';
const ref={id:'S1',title:'MedlinePlus',url:'https://medlineplus.gov/asthma.html'};
test('FAQ routing separates diagnostics from symptoms and preserves source provenance',()=>{
 const p={deck:3,text:'Diagnostic tests include a breathing test.',intent:'identify',record:'fixture',url:ref.url};
 assert.deepEqual(faqPassages(p).map(p=>p.deck),[4]);
 const both=faqPassages({...p,text:'The condition has no symptoms. Diagnosis requires tests.'});assert.deepEqual(both.map(p=>p.deck),[4,3]);
 for(const row of both){assert.equal(row.record,p.record);assert.equal(row.sourceDeck,3);assert.equal(row.frameworkVersion,'medical-faq-v3')}
 assert.deepEqual(faqPassages({deck:4,text:'A treatment passage.'}).map(p=>p.deck),[5]);
 assert.deepEqual(faqPassages({deck:5,text:'An outcome passage.'}).map(p=>p.deck),[6]);
 assert.equal(faqQuestions.length,6);
});
test('Local Buddy treatment notices are retained and browser replies omit historical decks',()=>{
 const context={topic:'Asthma',role:'General reader',passages:[],records:[]};
 assert.equal(domainAnswer(context,5).treatmentNotice,generalTreatmentNotice);
 assert.equal(domainAnswer({...context,role:'Medical professional'},5).treatmentNotice,undefined);
 const draft={answer:{id:0,claims:[]},decks:[{id:5,claims:[]}]};
 assert.deepEqual(presentDraft(draft,{sources:[]},{mode:'search',role:context.role},'fixture',false).decks,[]);
});
test('browser export contains the direct answer and its cited sources without legacy sections',()=>{
 const answer={blocks:[{text:'A sourced answer.',references:[ref,{url:'javascript:alert(1)',title:'bad'}]}],gaps:['The study did not report this outcome.']};
 assert.equal(answerReferences(answer).length,1);
 const markdown=answerMarkdown({topic:'Asthma',role:'General reader',answer,decks:[{id:1,text:'Historical content.'}]});
 assert.match(markdown,/## Browser Summary[\s\S]*A sourced answer\. \[S1\]/);
 assert.match(markdown,/The study did not report this outcome/);assert.match(markdown,/Authorized Citations/);
 assert.doesNotMatch(markdown,/Historical content|Six Medical Decks|Buddy says|javascript:/);
 assert.equal((markdown.match(/https:\/\/medlineplus.gov/g)||[]).length,1);
});
test('Buddy keeps topic-appropriate education prompts separate from copied browser results',()=>{
 for(const [role,first] of [['General','What is it, in simple terms?'],['Clinicians','Definition and core concepts']]){
  const prompts=buddyLearningQuestions(role);
  assert.equal(prompts.length,6);assert.equal(prompts[0],first);
  const copy=answerMarkdown({topic:'Pituitary gland',role,answer:{text:'No supporting passage was supplied.'}});
  assert.ok(prompts.every(prompt=>!copy.includes(prompt)));
 }
});
test('session metadata parser rejects missing, malformed and owner-mismatched claims',()=>{
 const id='11111111-1111-4111-8111-111111111111',sid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const token=claims=>'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';
 assert.equal(sessionIdFromVerifiedAccessToken(token({sub:id,session_id:sid}),id),sid);
 for(const value of ['opaque','x.!.y',token({sub:'other',session_id:sid}),token({sub:id}),token({sub:id,session_id:'bad'})])assert.equal(sessionIdFromVerifiedAccessToken(value,id),null);
});
test('clinical Markdown retains passage IDs, per-claim quotations and evidence gaps in the three report sections',()=>{
 const one={id:'Source_1',title:'Study',url:'https://example.test/study',quote:'Only the primary outcome was measured.'};
 const two={...one,id:'PMID: 12345678',quote:'The follow-up period ended at six months.'};
 const answer={clinicalSynthesis:true,blocks:[
  {text:'Only the primary outcome was measured.',references:[one],section:'synthesis'},
  {text:'Follow-up ended at six months.',references:[two],section:'limitations'},
  {text:'An unsupported addition.',references:[],section:'evidence'}
 ]};
 const md=answerMarkdown({topic:'Methods',role:'Clinicians',answer});
 assert.match(md,/## Clinical Synthesis[\s\S]+Only the primary outcome was measured\. \[Source_1\]/);
 assert.match(md,/## Evidence Breakdown[\s\S]+## Limitations & Contraindications[\s\S]+Follow-up ended at six months\. \[PMID: 12345678\]/);
 assert.match(md,/\* \[Source_1\] \[Study\]/);
 assert.match(md,/\* \[PMID: 12345678\] \[Study\]/);
 assert.doesNotMatch(md,/An unsupported addition/);
});
