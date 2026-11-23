import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyCitedReview,citedEvidence,prepareCited,prepareCitedReview,presentCited} from '../server/model-cited.mjs';

const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources'].map(n=>['/'+n+'.json',{text:readFileSync(new URL('../dist/'+n+'.json',import.meta.url),'utf8')}]));
for(const role of ['General','Clinicians']){
 test(role+' Buddy reviews approved deck summaries independently and preserves other excerpts',()=>{
  const input={topic:'Leukemia',question:'What is leukemia?',mode:'chat',role,deck:0};
  const prepared=prepareCited(input,citedEvidence(assets,input));
  const payload=JSON.parse(prepared.messages[1].content);
  assert.equal(payload.deckEvidence.length,6);
  assert.deepEqual(prepared.schema.required,['answer','deckClaims']);
  const [a,b,c]=payload.deckEvidence.filter(d=>d.passages.length);
  const claimFor=deck=>{
   const source=deck.passages[0];
   return {deck:deck.deck,text:source.text.match(/^.*?[.?!.](?:\s|$)/s)?.[0].trim()||source.text,sources:[source.id]};
  };
  const good=claimFor(a),unsupported=claimFor(b),wrongSource={...claimFor(c),sources:[good.sources[0]]};
  const raw={answer:[],deckClaims:[good,unsupported,wrongSource]};
  const check=prepareCitedReview(raw,prepared,input);
  assert.deepEqual(check.claims.map(c=>c.id),['D'+a.deck,'D'+b.deck]);
  const review={checks:[{id:'D'+a.deck,verdict:'supported',sources:good.sources,...(role==='Clinicians'?{quotes:[good.text]}:{})}]};
  const direct=presentCited(applyCitedReview(review,check,prepared,input),prepared,input,'test');
  assert.match(direct.decks[a.deck-1].blocks[0].verification,/AI summary/);
  assert.equal(direct.decks[a.deck-1].blocks[0].text,good.text);
  assert.equal(direct.decks[a.deck-1].blocks[0].references[0].id,good.sources[0]);
  for(const untouched of [b,c])assert.deepEqual(direct.decks[untouched.deck-1],prepared.overviewDecks[untouched.deck-1]);
  const injectedReview={checks:[{id:'D'+a.deck,verdict:'supported',sources:[b.passages[0].id],quotes:[good.text]}]};
  const rejected=presentCited(applyCitedReview(injectedReview,check,prepared,input),prepared,input,'test');
  assert.deepEqual(rejected.decks,prepared.overviewDecks);
  assert.deepEqual(presentCited(raw,prepared,input,'test').decks,prepared.overviewDecks);
 });
}

test('Buddy keeps the direct introduction when an overview section fails its independent check',()=>{
 const input={topic:'Leukemia',question:'What is leukemia?',mode:'chat',role:'General',deck:0};
 const prepared=prepareCited(input,citedEvidence(assets,input));
 const introSource=prepared.evidence.sources.find(s=>s.overview);
 const deck=prepared.deckEvidence.find(d=>d.passages.length);
 const source=deck.passages[0];
 const intro={text:introSource.text.match(/^.*?[.!?](?:\s|$)/s)[0].trim(),sources:[introSource.id]};
 const claim={deck:deck.deck,text:source.text.match(/^.*?[.!?](?:\s|$)/s)[0].trim(),sources:[source.id]};
 const check=prepareCitedReview({answer:[intro],deckClaims:[claim]},prepared,input);
 const review={checks:[{id:'C1',verdict:'supported',sources:intro.sources},{id:'D'+deck.deck,verdict:'unsupported',sources:[]}]};
 const rendered=presentCited(applyCitedReview(review,check,prepared,input),prepared,input,'test');
 assert.equal(rendered.answer.blocks[0].text,intro.text);
 assert.deepEqual(rendered.decks,prepared.overviewDecks);
});
