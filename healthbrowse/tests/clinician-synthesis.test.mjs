import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCited,prepareCitedReview,applyCitedReview,presentCited} from '../server/model-cited.mjs';
import {generationMessages,validateDraft,presentDraft,reviewMessages} from '../server/model-evidence.mjs';
import {documentEvidence} from '../server/document-evidence.mjs';
import {quantitativeSupport} from '../server/clinician-synthesis.mjs';

const input={role:'Clinicians',mode:'chat',topic:'Clinical study',question:'How strong is the evidence for the reported outcome?',deck:0};
const sources=[{id:'S1',url:'https://a.example/article',deck:1,text:'The prospective cohort reported a response in 10% of participants.',publicationTypes:['Observational Study'],sourceType:'research abstract',abstractOnly:true},
 {id:'S2',url:'https://b.example/article',deck:2,text:'The second cohort found no effect on the same outcome.'}];
const evidence={sources,domains:[],style:'Clinical'};
function audited(claim,verdict){
 const p=prepareCited(input,evidence);
 const review=prepareCitedReview({answer:[claim]},p,input);
 const decision={checks:review.claims.map(c=>({id:c.id,...verdict}))};
 return presentCited(applyCitedReview(decision,review,p,input),p,input,'test');
}
test('clinical classification follows the medical domain for uploaded documents',()=>{
 const file=title=>[{id:'doc-1234567890abcdef',kind:'page',pages:[{number:1,text:title+' reports the criteria in a table of findings.'}]}];
 const doc=(title,question)=>documentEvidence(file(title),{...input,question});
 const clinical=doc('Clinical trial report','Which clinical findings were reported?');
 const enterprise=doc('Internal control audit','Which SOX controls were inspected?');
 assert.equal(clinical.clinicalDocument,true);assert.equal(enterprise.clinicalDocument,false);
 for(const [e,expect] of [[clinical,true],[enterprise,false]]){
  const p=prepareCited(input,e);
  assert.equal(!!p.schema.properties.answer.items.properties.section,expect);
  assert.match(p.messages[0].content,/DOCUMENT MODE/);
 }
});
test('two-sided conflicts link both exact passages without publishing an unqualified conclusion',()=>{
 const r=audited({text:'The intervention improved outcomes.',sources:['S1'],section:'synthesis'},
  {verdict:'conflicting',sources:['S1','S2'],quotes:sources.map(s=>s.text)});
 assert.equal(r.answer.clinicalSynthesis,true);assert.equal(r.answer.blocks.length,1);
 const block=r.answer.blocks[0];assert.equal(block.section,'limitations');assert.match(block.text,/conflicting/);
 assert.deepEqual(block.references.map(s=>[s.id,s.quote]),sources.map(s=>[s.id,s.text]));
 const wrong=audited({text:'The intervention improved outcomes.',sources:['S1'],section:'synthesis'},
  {verdict:'conflicting',sources:['S1','S2'],quotes:[sources[0].text,sources[0].text]});
 assert.deepEqual(wrong.answer.blocks,[]);
});
test('exact ID and quote checks apply even when a clinician support verdict says supported',()=>{
 const supported={text:'A cohort reported a 10 percent response.',sources:['S1'],section:'evidence'};
 const yes=audited(supported,{verdict:'supported',sources:['S1'],quotes:[sources[0].text]});
 assert.deepEqual(yes.answer.blocks.map(b=>[b.section,b.citation.id,b.citation.quote]),[['evidence','S1',sources[0].text]]);
 for(const [text,quote] of [['A cohort reported a 12% response.',sources[0].text],[supported.text,'There was a clear clinical benefit.'],['<think>Hidden text.</think> A cohort reported a response.',sources[0].text]]){
  const no=audited({...supported,text},{verdict:'supported',sources:['S1'],quotes:[quote]});
  assert.equal(no.answer.blocks.length,0);
 }
 assert.equal(quantitativeSupport('1,200 participants with 12 percent response',['1200 participants with 12% response']),true);
 assert.equal(quantitativeSupport('12% improved',['12 patients improved']),false);
});
test('quantitative checks keep dose units and all denominators with the measured number',()=>{
 assert.equal(quantitativeSupport('The figure gives 5 mg/kg.',['The figure gives 5 mg.']),false);
 assert.equal(quantitativeSupport('The figure gives 5 mg.',['The figure gives 5 micrograms.']),false);
 assert.equal(quantitativeSupport('The figure gives 5 mg.',['The figure gives 5 mg/kg/day.']),false);
 assert.equal(quantitativeSupport('The figure gives 5 mcg/kg/day.',['The figure gives 5 µg per kilogram per day.']),true);
});
test('legacy provider preserves sections and literal citation spans, with provenance available to review',()=>{
 const raw={answer:{claims:[{text:'The reported response was 10 percent.',support:[{id:'S1',quote:sources[0].text}],section:'evidence'}]},decks:[]};
 const draft=validateDraft(raw,input,evidence);
 const r=presentDraft(draft,evidence,input,'test',false);assert.equal(r.answer.blocks[0].section,'evidence');assert.equal(r.answer.clinicalSynthesis,true);
 assert.throws(()=>validateDraft({...raw,answer:{claims:[{...raw.answer.claims[0],text:'The reported response was 33%.'}]}},input,evidence),/Numeric/);
 const p=prepareCited(input,evidence),audit=prepareCitedReview({answer:[]},p,input);
 assert.deepEqual(JSON.parse(audit.messages[1].content).sources.find(s=>s.id==='S1').publicationTypes,['Observational Study']);
 for(const messages of [generationMessages(input,evidence),p.messages])assert.match(messages[0].content,/comparator and outcome/);
 for(const messages of [reviewMessages(draft,evidence,input),audit.messages])assert.match(messages[0].content,/conflicting evidence/);
});

test('source-only trial answers require the right subject and finding, and keep the clinical conclusion open',()=>{
 const query={role:'Clinicians',mode:'search',topic:'Asthma',question:'What were the primary outcomes in asthma trials?',deck:0};
 const wrong={id:'S0',url:'https://example.test/other',title:'Unrelated trial',text:'The main trial outcome was assessment completion.'};
 const background={id:'S1',url:'https://example.test/asthma',title:'Asthma trial',text:'A trial protocol described study enrollment procedures.',publicationTypes:['Randomized Controlled Trial']};
 const relevant={id:'S2',url:'https://example.test/trial',title:'Asthma trial',text:'The trial reported its primary outcome at the second visit.',publicationTypes:['Randomized Controlled Trial']};
 for(const role of ['General reader','Clinicians']){
  const req={...query,role},sourceOnly=rows=>presentCited({answer:[]},{evidence:{sources:rows}},req,'').answer;
  const hit=sourceOnly([wrong,background,relevant]);
  assert.deepEqual(hit.blocks.map(b=>[b.citation.id,b.section,b.text]),[['S2',role==='Clinicians'?'evidence':undefined,relevant.text]]);
  assert.equal(hit.generation,undefined);
  assert.deepEqual(sourceOnly([wrong,background]).blocks,[]);
 }
});
