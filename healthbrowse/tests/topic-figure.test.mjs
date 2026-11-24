import test from 'node:test';
import assert from 'node:assert/strict';
import {medicalFigureResponse} from '../server/education-visuals.mjs';
import {publicFigureResponse} from '../server/public-figure.mjs';

const request = (route,params) => new Request('https://app.test/api/browser/'+route+'?'+new URLSearchParams(params));
const result = query => Response.json({query});
function file(id,title,changes={}) {
 return {ns:6,pageid:id,title:'File:'+title,imageinfo:[{width:1600,mime:'image/png',
  thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/'+id+'.png',
  descriptionurl:'https://commons.wikimedia.org/wiki/File:'+title.replaceAll(' ','_'),
  extmetadata:{LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0'},
   Artist:{value:'<b>Educational publisher</b>'},...changes}
 }]};
}

test('medical result discovers credited reusable figures via the exact subject page and serves stable file IDs',async()=>{
 const topic='Thalassemia',names=['Thalassemia blood film.png','Thalassemia inheritance.png'];
 const files=names.map((t,i)=>file(57000+i,t));
 const calls=[];
 const lookup=async (href,options)=>{
  const url=new URL(href);calls.push(url);
  assert.equal(options.redirect,'manual');assert.ok(options.signal);
  assert.match(options.headers['User-Agent'],/HealthBrowse\/.*https:\/\/github\.com\/Healthbrowse\/medical_assistant/);
  if(url.hostname==='en.wikipedia.org'){
   assert.equal(url.searchParams.get('titles'),topic);
   return result({pages:[{ns:0,pageid:425,title:topic,pageimage:names[0],
    images:[{ns:6,title:'File:'+names[1]},{ns:6,title:'File:Thalassemia awareness ribbon.png'},{ns:6,title:'File:Hospital building.png'}]}]});
  }
  assert.equal(url.hostname,'commons.wikimedia.org');assert.equal(url.searchParams.get('titles'),names.map(n=>'File:'+n).join('|'));
  return result({pages:files});
 };
 const data=await (await medicalFigureResponse(request('medical-figure',{topic}),{},lookup)).json();
 assert.equal(calls.length,2);assert.equal(data.visuals.length,2);
 assert.deepEqual(data.visual,data.visuals[0]);assert.equal(data.visual.attribution,'Educational publisher');
 assert.equal(data.visual.license,'CC BY 4.0');
 assert.equal(data.visual.licenseUrl,'https://creativecommons.org/licenses/by/4.0');
 assert.equal(data.visual.src,'/api/browser/public-figure?id=commons-57000&asset=1');
 assert.match(data.visual.sourceUrl,/Thalassemia_blood_film/);
 const image=await publicFigureResponse(new Request('https://app.test'+data.visual.src),async (href,options)=>{
  assert.equal(href,files[0].imageinfo[0].thumburl);
  if(!options.headers?.['User-Agent']?.includes('https://github.com/Healthbrowse/medical_assistant')){
   return new Response('Please set a user-agent',{status:403});
  }
  return new Response(Uint8Array.of(137,80,78,71,13,10,26,10));
 });
 assert.equal(image.headers.get('Content-Type'),'image/png');
});

test('general topics can use relevant Commons file titles after a missing subject page or article outage',async()=>{
 for(const [i,topic] of ['Tidal turbines','Geothermal gradient'].entries()) {
  const lookup=async href=>{
   const url=new URL(href);
   if(url.hostname==='en.wikipedia.org'){if(i)throw Error('Temporary provider failure');return result({pages:[{ns:0,title:topic,missing:true}]});}
   assert.equal(url.searchParams.get('generator'),'search');
   return result({pages:[file(57100,topic+' close-up.jpg',{LicenseShortName:{value:'Fair use'}}),
    file(57101,'Museum architecture.png'),file(57102,topic+' logo.png'),file(57110+i,topic+' technical diagram.png')]});
  };
  const {visuals}=await (await publicFigureResponse(request('public-figure',{topic}),lookup)).json();
  assert.equal(visuals.length,1);assert.match(visuals[0].caption,/technical diagram/);
 }
});

test('sensitive input, ambiguous pages, invalid file records and unknown rights never generate images',async()=>{
 for(const topic of ['my blood test','Patient Jane Smith','Case ID 890123','me@example.com','Jane\nhealth','Please find Bob','<script>']){
  const calls=[];
  const res=await medicalFigureResponse(request('medical-figure',{topic}),{},async url=>{calls.push(url);return result({});});
  assert.equal(res.status,400,topic);assert.deepEqual(calls,[]);
 }
 let calls=0;
 const disambig=await publicFigureResponse(request('public-figure',{topic:'Mercury'}),async()=>{
  calls++;return result({pages:[{ns:0,pageid:799,title:'Mercury',pageprops:{disambiguation:''}}]});
 });
 assert.equal((await disambig.json()).visual,null);assert.equal(calls,1);
 const denied=await publicFigureResponse(request('public-figure',{id:'commons-57444',asset:1}),async()=>result({pages:[file(57444,'Scene.png',{Restrictions:{value:'Permission required'}})]}));
 assert.equal(denied.status,404);
});
