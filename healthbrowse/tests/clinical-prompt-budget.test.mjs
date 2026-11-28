import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactGeneration,contextCost,ContextLimit} from '../server/model-context.mjs';
import {evidenceFor} from '../server/model-evidence.mjs';
import {groundedEvidence,prepareGrounded,decodeGrounded} from '../server/model-grounded.mjs';
import {prepareCited,prepareCitedReview,applyCitedReview,presentCited} from '../server/model-cited.mjs';
import {clinicalBuddyPrompt,compactClinicalBuddyPrompt,clinicalSemanticReview,clinicalPromptVersion} from '../server/clinical-prompt.mjs';

const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(name=>[
 '/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}
]));
const question=(topic,role)=>({topic,question:'What is '+topic+'?',role,mode:'search',deck:0});

test('documentation absence remains distinct from a negative history in active generation and review instructions',()=>{
 const input={...question('Synthetic evidence','Medical professional'),mode:'chat',deck:1};
 const source={id:'D1',deck:1,title:'Synthetic report',text:'No prior bleeding is documented.'};
 const evidence={documentMode:true,clinicalDocument:true,sources:[source],domains:[]};
 const prepared=prepareCited(input,evidence);
 const review=prepareCitedReview({answer:[{text:source.text,sources:['D1'],section:'synthesis'}]},prepared,input);
 for(const policy of [clinicalBuddyPrompt,compactClinicalBuddyPrompt,clinicalSemanticReview,prepared.messages[0].content,
  review.messages[0].content,compactGeneration(input,evidence).messages[0].content]){
  assert.match(policy,/absence of documentation.{0,60}confirmed negative finding/i);
 }
 const reference=readFileSync(new URL('../docs/clinical-buddy-prompt.md',import.meta.url),'utf8');
 assert(reference.includes('**Prompt version:** '+clinicalPromptVersion));
 for(const policy of [clinicalBuddyPrompt,compactClinicalBuddyPrompt,clinicalSemanticReview])assert(reference.includes(policy),'Documented prompt diverges from runtime');
});

test('grounded prompts preserve all six source decks for General and clinician searches within the existing budget',()=>{
 for(const topic of ['Leukemia','Sore Throat'])for(const role of ['General reader','Medical professional']){
  const input=question(topic,role),evidence=groundedEvidence(assets,input),prepared=prepareGrounded(input,evidence);
  const label=role+' / '+topic;
  assert.ok(contextCost(prepared.messages,prepared.maxTokens)<=8192,label+' exceeds context budget');
  assert.deepEqual([...new Set(prepared.evidence.sources.filter(source=>!source.overview).map(source=>source.deck))].sort(),[1,2,3,4,5,6],label+' lost a deck');
  for(let deck=1;deck<=6;deck++){
   const schema=prepared.schema.properties.decks.properties[deck];
   const ids=prepared.evidence.sources.filter(source=>source.deck===deck&&!source.overview).map(source=>source.id);
   assert.equal(schema.maxItems,1,label+' cannot answer an available deck');
   assert.deepEqual(schema.items.properties.sources.items.enum,ids,label+' source IDs diverge from evidence');
  }
  for(const source of prepared.evidence.sources){
   assert.equal(source.text,evidence.sources.find(original=>original.id===source.id)?.text,label+' truncated a passage');
  }
 }
});

test('main compact prompts retain useful complete evidence for both audiences without changing the context limit',()=>{
 for(const topic of ['Leukemia','Sore Throat'])for(const role of ['General reader','Medical professional']){
  const input=question(topic,role),evidence=evidenceFor(assets,topic,role,input.question),prepared=compactGeneration(input,evidence);
  assert.ok(contextCost(prepared.messages,prepared.maxTokens)<=8192,role+' / '+topic);
  assert.ok(prepared.evidence.sources.some(source=>source.text.length>=20),'No useful source retained');
  for(const source of prepared.evidence.sources){
   assert.equal(source.text,evidence.sources.find(original=>original.id===source.id)?.text);
  }
 }
});

test('compact clinical grounding still fails closed without evidence and rejects invented source IDs',()=>{
 const input=question('Leukemia','Medical professional'),evidence=groundedEvidence(assets,input);
 assert.throws(()=>prepareGrounded(input,{...evidence,sources:[]}),ContextLimit);
 assert.throws(()=>compactGeneration(input,{...evidence,sources:[]}),ContextLimit);
 const prepared=prepareGrounded(input,evidence);
 const raw={answer:[{text:'This claim has no retrieved evidence.',sources:['UNRETRIEVED']}],
  decks:Object.fromEntries(Array.from({length:6},(_,index)=>[index+1,[]])),gaps:[]};
 assert.throws(()=>decodeGrounded(raw,input,prepared),/Unknown or misfiled source/);
 assert.match(prepared.messages[0].content,/Uploaded files are not automatically guidelines/);
 assert.match(prepared.messages[0].content,/Preserve negation, uncertainty/);
 assert.match(prepared.messages[0].content,/Never fabricate references, numbers, doses/);
});

test('requested full clinical depth can survive cited review and presentation while rapid output remains capped',()=>{
 const labels=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda','mu'];
 const sources=labels.map((label,index)=>({id:'S'+(index+1),deck:1,title:'Evidence for '+label,
  url:'https://example.test/'+label,sourceType:'research report',
  text:'The study reported a clinical outcome for the '+label+' cohort.'}));
 const evidence={sources,domains:[],style:'Clinical'};
 const raw={answer:sources.map(source=>({text:source.text,sources:[source.id],section:'evidence'}))};
 for(const [depth,limit] of [['rapid',6],['full',12]]){
  const input={role:'Medical professional',mode:'chat',topic:'Clinical study',question:'What outcomes were reported?',deck:0,clinicalContext:{depth}};
  const prepared=prepareCited(input,evidence),check=prepareCitedReview(raw,prepared,input);
  assert.equal(prepared.schema.properties.answer.maxItems,limit);
  assert.equal(check.claims.length,limit,'Review lost the requested depth');
  const review={checks:check.claims.map(claim=>({id:claim.id,verdict:'supported',sources:claim.sources,
   quotes:claim.sources.map(id=>sources.find(source=>source.id===id).text)}))};
  const approved=applyCitedReview(review,check,prepared,input);
  assert.equal(presentCited(approved,prepared,input,'fixture-model').answer.blocks.length,limit,'Presentation lost the reviewed depth');
 }
});
