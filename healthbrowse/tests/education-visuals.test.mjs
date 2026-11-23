import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {educationalVisual,educationImage} from '../server/education-visuals.mjs';
const assets={'/education-figures.json':{text:readFileSync(new URL('../dist/education-figures.json',import.meta.url),'utf8')}};
test('licensed illustrations match biology topics in both roles and avoid unrelated pathology',()=>{
 for(const role of ['General reader','Medical professional'])for(const topic of ['bilirubin','pituitary gland','heart','DNA']){
  const f=educationalVisual(assets,{topic,question:'What is '+topic+'?',mode:'search',role});assert.ok(f);assert.equal(f.license,'CC BY 4.0');assert.match(f.sourceUrl,/b0058a743bdd2cc08196abaaa7d5469970c0d80c/);assert.ok(f.alt&&f.attribution);assert.doesNotMatch(f.title,/Tumor/);
 }
 assert.match(educationalVisual(assets,{topic:'pituitary gland',question:'What is the pituitary gland?',mode:'search'}).title,/Complex/);
 assert.equal(educationalVisual(assets,{topic:'photosynthesis',question:'What is photosynthesis?',mode:'search'}),null);
 assert.equal(educationalVisual(assets,{topic:'Mitochondria',question:'What is mitochondria?',mode:'search'}).id,'nhgri-mitochondria');
 assert.equal(educationalVisual(assets,{topic:'bilirubin',question:'Explain my files',mode:'search',attachments:[{}]}),null);
 assert.equal(educationalVisual(assets,{topic:'bilirubin',mode:'chat'}),null);
});
test('image proxy serves only pinned catalog images and checks content and size',async t=>{
 const id='m46707-fig-ch19_03_04',request=(query=id,method='GET')=>new Request('https://site.test/api/education-image?id='+encodeURIComponent(query),{method});let calls=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{calls++;assert.match(url,/^https:\/\/raw.githubusercontent.com\/openstax\/osbooks-anatomy-physiology\/b0058a743bdd2cc08196abaaa7d5469970c0d80c\/media\/1905_Erythrocyte_Life_Cycle.jpg$/);assert.equal(opts.redirect,'manual');return new Response(Uint8Array.from([255,216,255,0,1]),{headers:{'Content-Type':'image/jpeg'}})});
 const r=await educationImage(request(),assets);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.equal((await r.arrayBuffer()).byteLength,5);
 assert.equal((await educationImage(request('https://private.test'),assets)).status,404);assert.equal(calls,1);
 assert.equal((await educationImage(request(id,'POST'),assets)).status,405);
 t.mock.method(globalThis,'fetch',async()=>new Response('<script>bad</script>',{headers:{'Content-Type':'image/jpeg'}}));assert.equal((await educationImage(request(),assets)).status,502);
 t.mock.method(globalThis,'fetch',async()=>new Response('oversize',{headers:{'Content-Length':'2000001'}}));assert.equal((await educationImage(request(),assets)).status,502);
});

test('frequently requested diagrams retain their citations and serve real bundled JPEGs without network access',async t=>{
 const offline={...assets};
 const topics={'mitochondria':'nhgri-mitochondria','bilirubin':'m46707-fig-ch19_03_04','pituitary gland':'m46699-fig-ch18_03_01'};
 const network=t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected external request')});
 for(const [topic,id] of Object.entries(topics)){
  const bytes=readFileSync(new URL('../dist/'+id+'.jpg',import.meta.url));
  offline['/'+id+'.jpg']={base64:true,type:'image/jpeg',text:bytes.toString('base64')};
  const visual=educationalVisual(offline,{topic,question:'What is '+topic+'?',mode:'search'});
  assert.equal(visual.id,id);
  assert.ok(visual.sourceUrl&&visual.licenseUrl&&visual.alt);
  if(id!=='nhgri-mitochondria')assert.match(visual.attribution,/CC BY 4\.0.*JPEG optimized/);
  const url=new URL(visual.src,'https://site.test');
  const result=await educationImage(new Request(url),offline);
  assert.equal(result.status,200);assert.equal(result.headers.get('Content-Type'),'image/jpeg');
  assert.ok(bytes.length>10000);assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
  const head=await educationImage(new Request(url,{method:'HEAD'}),offline);
  assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 }
 assert.equal(network.mock.callCount(),0);
});
