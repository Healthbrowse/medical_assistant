import test from 'node:test';
import assert from 'node:assert/strict';
import {generalBrowser} from '../server/general-browser.mjs';

function ask(question, fetcher, extra={}) {
  return generalBrowser(new Request('https://site.example/api/browser/general',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,...extra})}),{}, fetcher);
}

test('SOX searches distinguish the two sections and carry support into Buddy',async()=>{
  const results=[];
  for(const section of ['302','404']){
    const data=await (await ask('Explain SOX section '+section,assert.fail)).json();
    assert.equal(data.status,'answered');
    assert.ok(data.articles.length>=3 && data.articles.length<=5);
    assert.ok(data.blocks.every(b=>b.sourceIds.every(id=>data.articles.some(r=>r.id===id))));
    assert.ok(data.articles.some(r=>r.publisher.includes('Securities') && r.date && r.quote));
    results.push(data.blocks[0].text);
  }
  assert.match(results[0],/certifications/);
  assert.match(results[1],/annual assessment/);
});
test('General public lookups reject file payloads and screen sensitive queries before any external request',async()=>{
  assert.equal((await ask('What is Jupiter?',assert.fail,{attachments:[]})).status,400);
  for(const q of ['My email is person@example.com. Find a report.','I want to stitch my wound myself.', 'What is insulin?']){
    assert.equal((await ask(q,assert.fail)).status,422);
  }
  const personal=await (await ask('Summarize our confidential sales report for this quarter',assert.fail)).json();
  assert.equal(personal.status,'insufficient');
});
test('general retrieval filters unrelated results; abstracts and government metadata are scoped to the query',async()=>{
  const calls=[];
  const fetcher=async href=>{
    const url=new URL(href);calls.push(url);
    if(url.hostname==='www.gov.uk')return Response.json({results:[
      {title:'Tidal energy',description:'Tidal energy uses the movement of water from tides to generate electricity.',link:'/guidance/tides',first_published_at:'2021-06-18T07:00:00Z'},
      {title:'Wind turbines',description:'This guide covers offshore wind turbines.',link:'/wind'},
      {title:'Tidal energy',description:'An untrusted record should never be served.',link:'//external.example/test'}]});
    if(url.hostname==='api.crossref.org')return Response.json({message:{items:[{DOI:'10.1234/x',title:['Research on tidal energy'],publisher:'Oxford University Press','container-title':['Example journal'],published:{'date-parts':[[2022,3]]},abstract:'<p>Tidal energy can be studied through measurements of coastal water movement.</p>'}]}});
    throw Error('Unavailable');
  };
  const data=await (await ask('What is tidal energy?',fetcher)).json();
  assert.equal(data.status,'answered');assert.equal(data.articles.length,2);
  assert.equal(data.articles[0].date,'2021-06-18');assert.ok(data.articles.every(a=>a.quote && !a.url.includes('external')));
  assert.ok(calls.every(u=>!u.search.includes('What')));
});
test('empty sources yield an explicit gap without invented articles',async()=>{
  const data=await (await ask('quantum vortex',async()=>Response.json({}))).json();
  assert.equal(data.status,'insufficient');assert.deepEqual(data.articles,[]);
});
