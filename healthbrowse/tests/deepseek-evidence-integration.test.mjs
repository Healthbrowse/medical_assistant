import test from 'node:test';
import assert from 'node:assert/strict';
import {clearRetrievalCache,retrieveEvidence,retrieveLiteraturePacket} from '../server/live-evidence.mjs';
import {DEEPSEEK_MODELS,HF_CHAT_URL} from '../server/model-provider.mjs';

const env={MODEL_PROVIDER:'deepseek',HF_TOKEN:'test-planner-token'};
const assets={'/medline-topics.json':{text:JSON.stringify({topics:[{title:'Asthma',aliases:[],mesh:[{id:'D001249',label:'Asthma'}]}]})}};
const input={role:'Medical professional',question:'What were the outcomes in asthma trials?',topic:'Asthma',mode:'search',deck:0};
const publication=(id,title,type,abstractText)=>({id,title,source:'MED',pubYear:'2024',pubTypeList:{pubType:[type]},abstractText});
const review=publication('400','Outcomes in asthma trials: a systematic review','Systematic Review',
 '<h4>Results</h4>The asthma trials reported different completion rates across study visits. A cited trial was indexed as PMID: 401.');
const trial=publication('401','Outcomes in asthma trials: a randomized trial','Randomized Controlled Trial',
 '<h4>Methods</h4>The asthma trial enrolled 120 adult participants. <h4>Results</h4>The primary endpoint was study visit completion at eight weeks.');
const outcome='The primary endpoint was study visit completion at eight weeks.';

// All documents and results in this fixture are synthetic. The trace lets us
// check what left the retrieval service, including each canonical URL lookup.
function network(){
 const trace=[];
 async function fetcher(address,options){
  const url=new URL(address),body=options.body?JSON.parse(options.body):null;
  trace.push({url:url.href,body});
  assert.equal(options.redirect,'manual');
  if(address===HF_CHAT_URL){
   assert.equal(options.headers.Authorization,'Bearer '+env.HF_TOKEN);
   assert.equal(body.model,DEEPSEEK_MODELS.agent);
   assert.equal(body.tools[0].function.name,'plan_literature_search');
   return Response.json({model:DEEPSEEK_MODELS.agent,choices:[{finish_reason:'tool_calls',message:{tool_calls:[
    {type:'function',function:{name:'plan_literature_search',arguments:JSON.stringify({searches:[]})}}
   ]}}]});
  }
  assert.equal(options.credentials,'omit');
  assert.equal(new Headers(options.headers).has('Authorization'),false);
  if(url.hostname==='www.ebi.ac.uk'&&url.pathname.endsWith('/search')){
   const primary=url.searchParams.get('query')==='EXT_ID:401 AND SRC:MED';
   return Response.json({resultList:{result:[primary?trial:review]}});
  }
  if(url.hostname==='pubmed.ncbi.nlm.nih.gov'){
   const row=[trial,review].find(p=>url.pathname==='/'+p.id+'/');
   assert.ok(row);
   return new Response('<head><title>'+row.title+' - PubMed</title><link rel="canonical" href="'+url.href+'"></head>');
  }
  throw Error('Unexpected fixture URL');
 }
 return {trace,fetcher};
}
test('V3.2 plan, indexed primary follow-up, and matching PubMed pages supply traceable passages to synthesis',async()=>{
 clearRetrievalCache();
 const {trace,fetcher}=network();
 const packet=await retrieveLiteraturePacket(input,env,undefined,fetcher,assets);
 const planner=trace.filter(x=>x.url===HF_CHAT_URL);
 assert.equal(planner.length,1);
 const vocabulary=JSON.parse(planner[0].body.messages[1].content);
 assert.ok(vocabulary.words.includes('asthma'));assert.deepEqual(vocabulary.mesh,['asthma']);
 const indexQueries=trace.filter(x=>new URL(x.url).pathname.endsWith('/search')).map(x=>new URL(x.url).searchParams.get('query'));
 assert.ok(indexQueries.some(q=>q.includes('Systematic Review')));
 assert.ok(indexQueries.includes('EXT_ID:401 AND SRC:MED'));
 assert.ok(indexQueries.every(q=>packet.query_decomposition.includes(q)));
 for(const row of [review,trial])assert.ok(trace.some(c=>c.url==='https://pubmed.ncbi.nlm.nih.gov/'+row.id+'/'));
 const source=packet.retrieved_sources.find(s=>s.source_id==='PMID: 401');
 assert.equal(source.cited_by,'PMID: 400');assert.ok(source.extracted_findings.some(f=>f.text===outcome));
 assert.ok(!packet.evidence_gaps.some(g=>g.includes('planner was unavailable')));
 const count=trace.length;
 const evidence=await retrieveEvidence(input,null,env,undefined,fetcher,assets);
 assert.equal(trace.length,count,'A verified public packet is reused between export and the browser');
 assert.deepEqual(evidence.retrieval.evidencePacket,packet);
 const passage=evidence.sources.find(s=>s.text===outcome);
 assert.equal(passage.url,source.url);assert.equal(passage.sourceIdentifier,source.source_id);
 assert.equal(passage.evidenceTier,1);assert.match(passage.id,/^S\d+$/);
});

test('only public topic terms leave the app for a personal question, and personal lookups are uncached',async()=>{
 clearRetrievalCache();
 const {trace,fetcher}=network();
 const personal={...input,role:'General reader',question:'I have asthma after rehearsing with an orchestra for 11 nights.'};
 for(let i=0;i<2;i++){
  const packet=await retrieveLiteraturePacket(personal,env,undefined,fetcher,assets);
  assert.ok(packet.retrieved_sources.length);
 }
 const planners=trace.filter(x=>x.url===HF_CHAT_URL);
 assert.equal(planners.length,2);
 for(const plan of planners)assert.deepEqual(JSON.parse(plan.body.messages[1].content).words,['asthma']);
 assert.doesNotMatch(decodeURIComponent(JSON.stringify(trace)),/orchestra|rehearsing|11 nights|I have asthma/i);
});

test('blocked and offline questions report an evidence gap without making outbound requests',async()=>{
 clearRetrievalCache();
 let dispatches=0;
 const fetcher=async()=>{dispatches++;throw Error('Unexpected dispatch')};
 for(const question of ['My asthma case contact is test@example.invalid','How can I do the stitching myself?','I cannot breathe right now']){
  const packet=await retrieveLiteraturePacket({...input,question},env,undefined,fetcher,assets);
  assert.deepEqual(packet.query_decomposition,[]);assert.deepEqual(packet.retrieved_sources,[]);assert.ok(packet.evidence_gaps.length);
 }
 const offline={...env,RETRIEVAL_LIVE:'off'};
 const packet=await retrieveLiteraturePacket(input,offline,undefined,fetcher,assets);
 assert.deepEqual(packet.retrieved_sources,[]);assert.match(packet.evidence_gaps[0],/disabled/);
 const local={sources:[{id:'local'}]};
 assert.equal(await retrieveEvidence(input,local,offline,undefined,fetcher,assets),local);
 assert.equal(dispatches,0);
});
