import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buddyOverviewDecks} from '../server/buddy-decks.mjs';
import {citedEvidence} from '../server/model-cited.mjs';
import {domainTitle} from '../dist/disease-framework.js';

const assets = Object.fromEntries(['clinical-passages','medline-topics','grounded-sources'].map(name => [
 '/'+name+'.json',{text:readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')}
]));
const input = {topic:'Leukemia',question:'What is leukemia?',mode:'chat',deck:0,role:'General reader'};

test('the disease overview uses six relevant section titles and attributable sources for each audience',()=>{
 for(const role of ['General reader','Medical professional']){
  const request={...input,role};
  const evidence=citedEvidence(assets,request);
  const decks=buddyOverviewDecks(request,evidence);
  assert.deepEqual(decks.map(d=>d.title),Array.from({length:6},(_,i)=>domainTitle(i+1,role)));
  for(const {deck,blocks} of decks){
   assert.equal(blocks.length,1);
   assert.equal(blocks[0].citation.deck,deck);
   assert.equal(blocks[0].text,blocks[0].citation.quote);
   assert.ok(evidence.sources.some(s=>s.id===blocks[0].citation.id && s.text.includes(blocks[0].text)));
  }
 }
});

test('missing, unrelated, historical, or unidentified passages leave an honest empty section',()=>{
 const source=citedEvidence(assets,input).sources.find(s=>s.deck===3);
 const evidence={sources:[
  {...source,url:'https://unsupported.example/'},
  {...source,historical:true},
  {...source,title:'Unrelated',heading:'',focus:'Other',text:'A source paragraph about a different subject.'}
 ]};
 assert.ok(buddyOverviewDecks(input,evidence).every(d=>d.blocks.length===0));
 for(const extra of [{deck:3},{mode:'search'},{attachments:[{}]}])
  assert.deepEqual(buddyOverviewDecks({...input,...extra},evidence),[]);
 assert.deepEqual(buddyOverviewDecks(input,{...evidence,documentMode:true}),[]);
});
