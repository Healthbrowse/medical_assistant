import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel} from 'miniflare';

test('Workers runtime sends literature requests and refuses redirects without following them',async()=>{
 const bundled=await build({stdin:{contents:`import {retrieveEvidence,clearRetrievalCache} from './server/live-evidence.mjs'; export default {async fetch(request){if(new URL(request.url).pathname==='/control'){try{new Request('https://wsearch.nlm.nih.gov/',{redirect:'error'});return Response.json({rejected:false})}catch(error){return Response.json({rejected:error.name==='TypeError'})}}clearRetrievalCache();return Response.json(await retrieveEvidence({topic:'Pituitary gland',question:'What does the pituitary gland do?',role:'Medical professional',mode:'search'},null,{},request.signal))}}`,resolveDir:process.cwd(),sourcefile:'worker-retrieval-test.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 let redirect=false;const requests=[];
 const runtime=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-07-01',log:new Log(LogLevel.ERROR),outboundService:async req=>{
  requests.push(req.url);const u=new URL(req.url);
  if(redirect)return new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}});
  if(u.hostname==='wsearch.nlm.nih.gov')return new Response('<nlmSearchResult><list><document url="https://medlineplus.gov/pituitarydisorders.html"><content name="title">Pituitary gland</content><content name="FullSummary">The pituitary gland produces hormones that regulate growth and other glands.</content></document></list></nlmSearchResult>');
  assert.equal(u.hostname,'www.ebi.ac.uk');
  return Response.json({resultList:{result:[{source:'MED',id:'12345',title:'Pituitary gland physiology',abstractText:'The pituitary gland produces hormones that regulate growth and other glands.'}]}});
 }});
 try{
  assert.equal((await(await runtime.dispatchFetch('http://test/control')).json()).rejected,true,'Reproduce the production-incompatible option in workerd');
  assert.equal(requests.length,0);
  const data=await(await runtime.dispatchFetch('http://test/retrieve')).json();assert.equal(requests.length,2);assert.equal(data.retrieval.sourceCount,2);assert.ok(data.sources.length);assert.ok(data.retrieval.providers.every(p=>p.status==='available'));
  redirect=true;requests.length=0;const rejected=await(await runtime.dispatchFetch('http://test/retrieve')).json();assert.equal(requests.length,2);assert.equal(rejected.sources.length,0);assert.ok(rejected.retrieval.providers.every(p=>p.httpStatus===302));assert.ok(requests.every(url=>!url.includes('unexpected.example')));
 }finally{await runtime.dispose()}
});
