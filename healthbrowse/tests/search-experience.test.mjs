import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchAnswer,domainAnswer,deckCount,buddyQuestions,fetchJSON,isOverviewQuestion} from '../dist/search-experience.js';
import {medlineIndex} from '../dist/medline.js';
import {medlinePassages} from '../dist/disease-framework.js';
import {remapPassages,correctSpelling} from '../dist/medcard.js';
import {resolveSearch,topicIndex} from '../dist/discovery.js';
import {questionDeck} from '../dist/clinical-engine.js';
const read=name=>JSON.parse(readFileSync(new URL('../dist/'+name+'.json',import.meta.url)));
const feed=read('medline-topics'),lookup=medlineIndex(feed),archive=remapPassages(read('clinical-passages')),taxonomy=read('taxonomy');
const context=topic=>({topic,role:'General reader',aliases:taxonomy.entities.find(e=>e.name===topic)?.aliases||[],passages:[...medlinePassages(lookup.find(topic),topic,feed),...(archive[topic]||[])],records:[]});
test('Buddy offers six evidence areas for optional follow-up',()=>{
 assert.equal(deckCount('General reader'),6);assert.equal(deckCount('Medical professional'),6);
 assert.deepEqual(buddyQuestions.map(q=>q.deck),[1,2,3,4,5,6]);
});
test('ordinary question wording, spelling corrections and aliases produce supported direct answers',()=>{
 for(const [topic,query,pattern] of [['Leukemia','What is lukemia?',/blood/i],['Leukemia','How is leukemia treated?',/treat/i],['Leukemia','What are the symptoms of leukemia?',/symptom/i],['Diabetes','Tell me about diabetes',/diabet/i],['High Blood Pressure','hypertension',/pressure/i]]){
  const answer=searchAnswer(context(topic),query);assert.equal(answer.supported,true,query+' '+answer.text);assert.ok(answer.citations.length,query);assert.match(answer.text,pattern);assert.ok(answer.checks.every(c=>c.status==='supported'));
 }
 assert.equal(questionDeck('How does treatment work?'),5);
});
test('the direct answer addresses the question rather than substituting a definition',()=>{
 const c=context('Leukemia'),symptoms=searchAnswer(c,'What are the symptoms of leukemia?');
 assert.notEqual(symptoms.text,c.passages.find(p=>p.overview).text);
 const missing=searchAnswer(c,'Does leukemia always come from a specific mutation XYZ123?');assert.equal(missing.supported,false);assert.equal(missing.citations.length,0);assert.doesNotMatch(missing.text,/six (decks|clinical decks|questions)/i);
});
test('chat overview recognition cannot replace a specific clinical question',()=>{
 const c=context('Leukemia');
 for(const q of ['What is leukemia?','Tell me about leukemia','Explain it','What is lukemia?'])assert.equal(isOverviewQuestion(c,q),true,q);
 for(const q of ['What is the treatment for leukemia?','What is the untreated disease course in leukemia?','Tell me about the prognosis of leukemia','What is the cause of leukemia?'])assert.equal(isOverviewQuestion(c,q),false,q);
});
test('guided exploration returns intact checked passages or a visible evidence gap for every deck',()=>{
 for(const topic of ['Leukemia','Diabetes','Asthma'])for(const n of [1,2,3,4,5,6]){
  const answer=domainAnswer(context(topic),n);assert.equal(answer.deck,n);assert.ok(answer.text.length);assert.equal(answer.citations.length,answer.checks.length);assert.ok(answer.checks.every(c=>c.status==='supported'));
 }
 assert.match(domainAnswer({...context('Leukemia'),passages:[]},4).text,/No source passage/);
 assert.equal(domainAnswer(context('Leukemia'),7),null);
});
test('full browser questions resolve independently of the previously selected topic',()=>{
 const index=topicIndex([...feed.topics.map(t=>({name:t.title,aliases:t.aliases||[]})),...taxonomy.entities]);
 for(const [q,expected] of [['What is lukemia?','Leukemia'],['How is asthma treated?','Asthma'],['What are the symptoms of diabetes?','Diabetes']])assert.ok(resolveSearch(correctSpelling(q),index).choices.includes(expected),q);
});
test('an unresponsive source request expires and caller cancellation propagates',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,{signal})=>new Promise((_,reject)=>{if(signal.aborted)reject(new Error('aborted'));else signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})}));
 await assert.rejects(fetchJSON('/fixture',{timeout:15}),/aborted/);
 const controller=new AbortController();controller.abort();await assert.rejects(fetchJSON('/fixture',{signal:controller.signal,timeout:10000}),/aborted/);
});

test('clinician excerpts preserve the actual retrieved record identifier and verbatim supporting passage',()=>{
 const c={...context('Leukemia'),role:'Medical professional'};
 for(const answer of [searchAnswer(c,'What is leukemia?'),domainAnswer(c,4)]) {
  assert.ok(answer.blocks.length);
  for(const block of answer.blocks) {
   const ref=block.citation;
   assert.ok(ref.id && c.passages.some(p=>p.record===ref.id && p.text===ref.quote && (p.sourceRecord||p.url)===ref.url));
   assert.deepEqual(block.references,[ref]);
   assert.ok(answer.text.includes('['+ref.id+']'));
  }
 }
});

test('clinician metadata answers cite the requested field without inventing a literature conclusion',()=>{
 const records=[{title:'Asthma review',authors:'Jane Author',url:'https://example.org/paper',date:'2026',
  studyDesign:'No trial design was retrieved'}];
 const answer=searchAnswer({...context('Asthma'),role:'Clinicians',records},'Who authored the asthma study?');
 assert.ok(answer.blocks.some(b=>b.text==='Jane Author'&&b.citation.quote==='Jane Author'&&b.citation.id===records[0].url));
 assert.doesNotMatch(answer.text,/2026|trial design/);
});

test('legacy clinician passages with no record or a repeated local identifier retain distinct source URLs',()=>{
 const rows=[
  {deck:4,text:'A diagnostic test is described in reference A.',url:'https://www.cdc.gov/example-a',focus:'Test topic',title:'A'},
  {deck:4,text:'Another diagnostic test is described in reference B.',url:'https://medlineplus.gov/example-b',focus:'Test topic',title:'B'}];
 for(const passages of [rows,rows.map(row=>({...row,record:'duplicate'}))]){
  const answer=domainAnswer({role:'Clinicians',topic:'Test topic',passages},4);
  assert.deepEqual(new Set(answer.citations.map(r=>r.id)),new Set(rows.map(r=>r.url)));
  assert.ok(answer.blocks.every(b=>b.citation.quote===b.text));
 }
});

test('offline clinical comparisons label source excerpts as background while awaiting appraisal',()=>{
 const c={...context('Leukemia'),role:'Medical professional'};
 const answer=searchAnswer(c,'How is leukemia treated? What was the comparator in the trial?');
 assert.ok(answer.blocks.length);
 assert.ok(answer.blocks.every(block=>block.section==='evidence'&&block.references[0].quote));
 assert.match(answer.gaps.join(' '),/reviewed conclusion/i);
 assert.equal(answer.supported,false);
});
