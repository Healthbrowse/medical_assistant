import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalFeedbackTags,clinicalReadingSources,clinicalFeedbackPayload,renderClinicalResponseExtras} from '../dist/clinical-response-extras.js';
import {renderClinicalSynthesis} from '../dist/answer-view.js';

const first={id:'S1',title:'Verified guideline excerpt',url:'https://example.org/guideline',sourceType:'clinical guideline',date:'2024; retrieved 2026-11-28'};
const second={id:'S2',title:'Study abstract',url:'https://pubmed.ncbi.nlm.nih.gov/12345678/',sourceType:'research abstract'};
const answer={clinicalInteraction:{promptVersion:'clinician-2026.11.28'},generation:{model:'@cf/example/model'},question:'PRIVATE CASE MUST NOT BE SENT',
 blocks:[{section:'synthesis',text:'A source-supported clinical comparison with qualifications.',references:[first,second]}]};

class Node{
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.value='';this.checked=false;this.listeners={};}
 append(...children){this.children.push(...children);}
 setAttribute(key,value){this.attrs[key]=value;}
 removeAttribute(key){delete this.attrs[key];}
 addEventListener(name,listener){this.listeners[name]=listener;}
 all(tag){return [this,...this.children.flatMap(child=>child.all('*'))].filter(child=>tag==='*'||child.tag===tag);}
}
function dom(t){
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>Object.assign(new Node('#text'),{textContent:text}),dispatchEvent:()=>true};
 t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document});
 return new Node('main');
}
const text=node=>node.all('*').map(child=>child.textContent||'').join('\n');

test('reading cards use supported claims, preserve companion citations and ignore uncited bibliography entries',()=>{
 const result=clinicalReadingSources({...answer,citations:[{id:'S3',title:'Irrelevant bibliography',url:'https://example.org/irrelevant'}],blocks:[...answer.blocks,
  {text:'Unsafe link must not establish a reading card.',references:[{...first,id:'BAD',url:'javascript:alert(1)'}]},
  {text:'Uncited assertion.'}]});
 assert.deepEqual(result.map(row=>row.reference.id),['S1','S2']);
 assert.equal(result[0].takeaway,answer.blocks[0].text);
 assert.deepEqual(result[0].companionSources.map(ref=>ref.id),['S1','S2']);
 assert.equal(result[0].date,'2024; retrieved 2026-11-28');
 assert(!JSON.stringify(result).includes('Irrelevant bibliography'));
});

test('deduplicate source URLs across anchors and uploaded document pages; never invent a minimum article quota',()=>{
 const doc={id:'D1',documentId:'doc-0123456789abcdef',userProvided:true,page:2,title:'Document 1 · page 2',sourceType:'uploaded document · not independently verified',url:''};
 const rows=clinicalReadingSources({blocks:[
  {text:'First quoted source point.',references:[first]},
  {text:'Another point from the same source.',references:[{...first,id:'S3',url:first.url+'#section'}]},
  {text:'Document statement on this page.',references:[doc]},
  {text:'A statement on another PDF page.',references:[{...doc,id:'D2',page:4,title:'Document 1 · page 4'}]}
 ]});
 assert.equal(rows.length,2);
 assert.deepEqual(rows[1].pages,[2,4]);
 assert.equal(rows[1].documentSource,true);
 assert.equal(rows[1].source,'uploaded document · not independently verified');
});

test('full clinical renderer adds extras only with interaction metadata and accepted source-backed blocks',t=>{
 const parent=dom(t);
 renderClinicalSynthesis(parent,answer);
 assert(parent.all('h3').some(node=>node.textContent==='Relevant clinical visual'));
 assert(parent.all('h3').some(node=>node.textContent==='Matching clinical sources'));
 assert.match(text(parent),/No suitable verified visual/);
 assert.match(text(parent),/supporting sources together/);
 assert.equal(parent.all('input').length,clinicalFeedbackTags.length);
 const legacy=new Node('main');renderClinicalSynthesis(legacy,{blocks:answer.blocks});
 assert.equal(legacy.all('form').length,0);
 assert.equal(renderClinicalResponseExtras(new Node('main'),{...answer,safety:{category:'emergency'}}),false);
 assert.equal(renderClinicalResponseExtras(new Node('main'),{...answer,clarification:{text:'Role?'}}),false);
 assert.equal(renderClinicalResponseExtras(new Node('main'),{...answer,blocks:[{text:'Uncited assertion.'}]}),false);
});

test('visuals use the existing attributed asset validator and reject arbitrary embedded images',t=>{
 const parent=dom(t);
 renderClinicalResponseExtras(parent,{...answer,clinicalVisual:{title:'Unsafe visual',alt:'Unsafe',attribution:'Unknown',sourceUrl:'javascript:alert(1)',src:'https://attacker.example/image'}});
 assert.equal(parent.all('img').length,0);
 const valid=new Node('main');
 renderClinicalResponseExtras(valid,{...answer,clinicalVisual:{title:'Inside a mitochondrion',alt:'Mitochondrial diagram',attribution:'NHGRI',
  sourceUrl:'https://www.genome.gov/genetics-glossary/Mitochondria',src:'/api/education-image?id=nhgri-mitochondria',caption:'Caption from the source catalog.'}});
 assert.equal(valid.all('img').length,1);
 assert.equal(valid.all('img')[0].referrerPolicy,'no-referrer');
 assert.equal(valid.all('img')[0].src,'/api/education-image?id=nhgri-mitochondria');
 assert.match(text(valid),/Caption from the source catalog/);
});

test('feedback contains only explicit ratings, known tags, note and bounded version/model metadata',()=>{
 const payload=clinicalFeedbackPayload(answer,{rating:4,tags:['Accurate Reasoning','invented tag'],note:'Please show guideline dates more prominently.'});
 assert.equal(payload.category,'source-correction');
 assert.match(payload.message,/4\/5 \(reviewer assessment\)/);
 assert.match(payload.message,/clinician-2026.11.28/);
 assert.match(payload.message,/@cf\/example\/model/);
 assert(!payload.message.includes(answer.question));
 assert(!payload.message.includes(answer.blocks[0].text));
 assert(!payload.message.includes(first.url));
 assert(!payload.message.includes('invented tag'));
 assert.throws(()=>clinicalFeedbackPayload(answer,{}),/Choose a rating or tag/);
 assert.throws(()=>clinicalFeedbackPayload(answer,{rating:9}),/1 to 5/);
 assert.throws(()=>clinicalFeedbackPayload(answer,{note:'Patient name: Example Patient'}),/Remove personal identifiers/);
 assert.throws(()=>clinicalFeedbackPayload(answer,{note:'a'.repeat(1001)}),/1,000/);
});

test('feedback is never submitted on rendering; explicit submission checks receipt and reuses ID on retry',async t=>{
 const parent=dom(t),calls=[];let nextId=0;
 renderClinicalResponseExtras(parent,answer,{makeId:()=>`request-${++nextId}`,request:async(path,options)=>{
  calls.push({path,...options});if(calls.length===1)throw Error('Temporary service failure');
  return {feedback:{id:'saved-feedback'}};
 }});
 assert.equal(calls.length,0);
 const form=parent.all('form')[0],score=parent.all('select')[0],button=parent.all('button').find(node=>node.type==='submit');
 score.value='5';
 await form.onsubmit({preventDefault(){}});
 assert.match(text(parent),/Temporary service failure/);
 assert.equal(button.disabled,false);
 await form.onsubmit({preventDefault(){}});
 assert.equal(calls[0].path,'/api/feedback');
 assert.equal(calls[0].method,'POST');
 assert.equal(calls[0].body.requestId,calls[1].body.requestId);
 assert.equal(nextId,1);
 assert.match(text(parent),/Feedback received for review/);
 assert.equal(button.disabled,true);
 assert.equal(score.disabled,true);
 await form.onsubmit({preventDefault(){}});
 assert.equal(calls.length,2);
});

test('an unconfirmed feedback result is not reported as a successful save',async t=>{
 const parent=dom(t);
 renderClinicalResponseExtras(parent,answer,{makeId:()=> 'request-1',request:async()=>({})});
 parent.all('select')[0].value='3';
 await parent.all('form')[0].onsubmit({preventDefault(){}});
 assert.match(text(parent),/receipt could not be confirmed/);
 assert(!text(parent).includes('Feedback received for review'));
});
