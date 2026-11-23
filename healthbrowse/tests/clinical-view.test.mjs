import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalSections} from '../dist/clinical-sections.js';
import {renderClinicalSynthesis} from '../dist/answer-view.js';

const first = {id:'Source_1', studyDesign:'Systematic review', title:'Guideline excerpt', url:'https://example.org/guide', quote:'Statement A.'};
const second = {id:'PMID: 12345678', title:'Study abstract', url:'https://pubmed.ncbi.nlm.nih.gov/12345678/', quote:'Statement B.'};
const block = (section,text,refs) => ({section, text, references:refs});

test('clinical sections preserve assigned identifiers, section order and references from overlapping passages',()=>{
 const groups = clinicalSections({blocks:[
  block('evidence','Statement B.',[second]),
  block('synthesis','Direct comparison.',[first,second]),
  block('limitations','The populations differ.',[second,first])
 ]});
 assert.deepEqual(groups.map(g=>g.key),['synthesis','evidence','limitations']);
 assert.deepEqual(groups.map(g=>g.blocks[0].references.map(r=>r.id)),[['Source_1','PMID: 12345678'],['PMID: 12345678'],['PMID: 12345678','Source_1']]);
 assert.equal(groups.flatMap(g=>g.notes).length,0);
});

test('clinical sections withhold the whole claim if a required source is missing, unusable, or has no identifier',()=>{
 const groups=clinicalSections({citations:[first],text:'Unsupported flat answer.',blocks:[
  {text:'Unknown citation',sourceIds:['Source_1','Other']},block('synthesis','Unsafe reference',[{...first,url:'javascript:unsafe()'}]),
  block('synthesis','Anonymous reference',[{...first,id:null}]),{text:'Unlinked clinical assertion.'},
  {text:'Resolvable clinical point.',sourceIds:['Source_1']}
 ]});
 assert.deepEqual(groups.flatMap(g=>g.blocks).map(b=>b.text),['Resolvable clinical point.']);
 assert.match(groups[2].notes.join(' '),/withheld/);
 assert(!JSON.stringify(groups).includes('Unsupported flat answer.'));
});

test('legacy passages occur once; app-owned diagnostic boundaries survive without a source and follow-ups remain separate',()=>{
 const groups=clinicalSections({diagnosisNotice:'Scope notice',blocks:[
  {kind:'diagnosis-lead',text:'Scope notice'}, {text:'Source excerpt A.',citation:first},
  {text:'Source excerpt A.',citation:first},{text:'Source excerpt B.',citation:second},
  {kind:'follow-up',text:'Clarifying question?'}]});
 assert.deepEqual(groups.map(g=>g.blocks.map(b=>b.text)),[['Source excerpt A.'],['Source excerpt B.'],[]]);
 assert.match(groups[0].notes.join(' '),/individual diagnosis/);
 assert(!groups[2].notes.join(' ').includes('withheld'));
 const none=clinicalSections({text:'Uncited directive.',citations:[first]});
 assert(none.every(g=>!g.blocks.length&&g.notes.length));
});

test('rendered clinician headings, inline links, source passages, gap copy and focus targets are accessible',t=>{
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};}
  append(...children){this.children.push(...children);}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(){}
  all(tag){return [this,...this.children.flatMap(n=>n.all('*'))].filter(n=>tag==='*'||n.tag===tag);}
 }
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
 t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
 const page=new Node('main');
 renderClinicalSynthesis(page,{blocks:[block('synthesis','Statement A.',[first])],followUpQuestions:['When was the assessment?']});
 assert.deepEqual(page.all('h3').map(n=>n.textContent),['Clinical Synthesis','Evidence Breakdown','Limitations & Contraindications']);
 assert.deepEqual(page.all('h3').map(n=>n.tabIndex),[-1,-1,-1]);
 assert.equal(page.all('section').filter(n=>n.dataset.clinicalSection==='evidence').length,1);
 const [inline]=page.all('a');
 assert.equal(inline.textContent,'[Source_1] ↗');
 assert.match(inline.attrs['aria-label'],/Source_1/);
 assert.equal(inline.href,first.url);
 assert.equal(page.all('blockquote')[0].textContent,first.quote);
 assert(page.all('small').some(n=>n.textContent==='Study design · Systematic review'));
 assert.equal(page.all('li')[0].textContent,'When was the assessment?');
});
