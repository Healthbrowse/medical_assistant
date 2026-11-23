import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {respond} from '../worker/routes.mjs';
test('public research assets are accessible to guests', async()=>{
 const assets={'/index.html':{text:'Research desk',type:'text/html'}};
 const req=new Request('https://test.invalid/',{headers:{'oai-authenticated-user-id':'example'}});
 assert.equal(await (await respond(req,{},assets)).text(),'Research desk');
 assert.equal((await respond(new Request(req.url),{},assets)).status,200);
 assert.equal((await respond(new Request('https://test.invalid/missing',{headers:req.headers}),{},assets)).status,404);
});

test('USGS water-cycle metadata and image load from the deployed bundle offline',async t=>{
 const network=t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected external request')});
 const bytes=readFileSync(new URL('../dist/usgs-water-cycle.jpg',import.meta.url));
 const assets={'/usgs-water-cycle.jpg':{base64:true,type:'image/jpeg',text:bytes.toString('base64')}};
 const endpoint='https://test.invalid/api/browser/public-figure?id=usgs-water-cycle';
 const {visual}=await (await respond(new Request(endpoint),{},assets)).json();
 assert.equal(visual.license,'Public domain');
 assert.equal(visual.sourceUrl,'https://www.usgs.gov/media/images/water-cycle-diagram-diagram-only');
 assert.match(visual.attribution,/Corson-Dosch.*Geological Survey/);
 const assetURL=new URL(visual.src,endpoint);
 const image=await respond(new Request(assetURL),{},assets);
 assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/jpeg');
 assert.ok(bytes.length<350*1024);assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
 assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
 const head=await respond(new Request(assetURL,{method:'HEAD'}),{},assets);
 assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal(network.mock.callCount(),0);
});
