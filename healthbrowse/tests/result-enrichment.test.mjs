import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedArticles,supportNodes} from '../dist/result-enrichment.js';
import {publicFigureResponse} from '../server/public-figure.mjs';
import {medicalFigureResponse} from '../server/education-visuals.mjs';

test('suggestions use real publication metadata, distinct HTTPS links and up to five records',()=>{
 const articles=Array.from({length:9},(_,i)=>({title:'Leukemia review '+i,url:'https://pubmed.ncbi.nlm.nih.gov/'+(i+1)+'/',pmid:String(i+1),date:'2025-02-10',journal:'A journal',studyDesign:'Systematic Review'}));
 const result=suggestedArticles({mode:'medical',topic:'Leukemia',query:'How is leukemia diagnosed?',articles:[...articles,{...articles[0],url:articles[0].url+'#section'},{...articles[0],url:'javascript:void(0)'}]});
 assert.equal(result.length,5);
 assert.deepEqual(result.map(r=>r.url),articles.slice(0,5).map(r=>r.url));
 assert.equal(result[0].date,'2025-02-10');assert.equal(result[0].publisher,'A journal');assert.match(result[0].takeaway,/review/);
 const [unknown]=suggestedArticles({mode:'medical',topic:'Sore throat',answer:{citations:[{url:'https://medlineplus.gov/sorethroat.html',title:'Sore throat',date:'2026-11-19'}]}});
 assert.equal(unknown.date,'','retrieval metadata cannot serve as a publication date');
});

test('visual claim nodes refer to the correct source and exclude unsupported text',()=>{
 const records=[{id:'G2',url:'https://www.sec.gov/rules',title:'Reporting rules'}];
 const nodes=supportNodes({blocks:[{text:'Example claim from the reference.',sourceIds:['G2']},{text:'Unsupported text',sourceIds:['G1']}]},records);
 assert.equal(nodes.length,1);assert.equal(nodes[0].ref,records[0]);assert.equal(nodes[0].label,'Example claim from the reference.');
});

test('public artwork requires matched encyclopedia ID, Commons attribution, recognized license, and raster bytes',async()=>{
 const calls=[],commons=(overrides={})=>({query:{pages:[{ns:6,title:'File:Saturn diagram.png',imageinfo:[{width:1440,thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/example.png',descriptionurl:'https://commons.wikimedia.org/wiki/File:Saturn_diagram.png',extmetadata:{Artist:{value:'<b>NASA</b>'},LicenseShortName:{value:'Public domain'},...overrides}}]}]}});
 const page=(id)=>({query:{pages:[{ns:0,pageid:id,pageimage:'Saturn_diagram.png',title:'Saturn'}]}});
 const run=(id,override={},raw=false)=>async url=>{calls.push(url);if(url.startsWith('https://en.wikipedia.org'))return Response.json(page(id));
 if(url.startsWith('https://commons.wikimedia.org'))return Response.json(commons(override));
 return new Response(raw?'unsafe':Uint8Array.from([137,80,78,71,13,10,26,10]));};
 const req=(id,asset=false)=>new Request('https://app.test/api/browser/public-figure?id='+id+(asset?'&asset=1':''));
 const result=await publicFigureResponse(req(82342),run(82342));
 const {visual}=await result.json();assert.equal(visual.attribution,'NASA');assert.equal(visual.license,'Public domain');assert.equal(visual.title,'Saturn');
 assert.equal((await publicFigureResponse(req(82342,true),run(82342))).headers.get('Content-Type'),'image/png');
 assert.equal((await publicFigureResponse(req(82342,true),run(82342,{},true))).status,502);
 assert.equal((await (await publicFigureResponse(req(82343),run(82343,{LicenseShortName:{value:'Fair use'}}))).json()).visual,null);
 assert.equal((await publicFigureResponse(req('private.example'),run(0))).status,400);
});

test('local medical figure lookup serves a subject-specific image without a model call',async()=>{
 const r=medicalFigureResponse(new Request('https://app.test/api/browser/medical-figure?topic=Mitochondria'),{});
 assert.equal((await r.json()).visual.id,'nhgri-mitochondria');
 assert.equal(medicalFigureResponse(new Request('https://app.test/api/browser/medical-figure'),{}).status,400);
});

test('the leukemia gallery pairs a general illustration with a cited example of one subtype',async()=>{
 const {curatedBrowserVisuals}=await import('../dist/browser-curated-images.js');
 for(const [topic,expected] of [
  ['leukaemia',['nci-leukemia-cells','cdc-aml-bone-marrow']],
  ['acute myeloid leukemia (AML)',['cdc-aml-bone-marrow']]
 ]){
  const figures=curatedBrowserVisuals(topic);
  const url=new URL('/api/browser/medical-figure','https://app.test');
  url.searchParams.set('topic',topic);
  const response=await medicalFigureResponse(new Request(url),{},()=>assert.fail('a bundled figure should need no network'));
  const {visual,visuals}=await response.json();
  assert.deepEqual(visuals,figures);
  assert.deepEqual(visual,figures[0]);
  assert.deepEqual(figures.map(f=>f.id),expected);
  assert.equal(new Set(figures.map(f=>f.sourceUrl)).size,expected.length);
  assert.match(figures.at(-1).caption,/one subtype, acute myeloid leukemia/);
 }
});

test('each public result mode attempts an image lookup using a public subject or a resolved page ID', async () => {
  const {visualLookupEndpoint} = await import('../dist/result-enrichment.js');
  assert.equal(visualLookupEndpoint({mode:'medical',topic:'Dengue',query:'Personal original question'}), '/api/browser/medical-figure?topic=Dengue');
  assert.equal(visualLookupEndpoint({mode:'general',topic:'Solar energy'}), '/api/browser/public-figure?topic=Solar+energy');
  assert.equal(visualLookupEndpoint({mode:'general',topic:'Saturn',illustrationPageId:26903}), '/api/browser/public-figure?id=26903');
  assert.equal(visualLookupEndpoint({mode:'general',topic:'The water cycle',articles:[{id:'evaporation',url:'https://www.usgs.gov/water'}]}), '/api/browser/public-figure?id=usgs-water-cycle');
  assert.equal(visualLookupEndpoint({mode:'medical',topic:'Private narrative',allowLookup:false}), '');
});

test('an at-a-glance label keeps a whole source-backed statement or uses its source title', () => {
  const ref = {title:'Pituitary hormones',url:'https://www.ncbi.nlm.nih.gov/guide'};
  const brief = 'This example can be verified when its conditions are met.';
  const long = 'A very long, qualified medical statement '.repeat(8) + 'if the qualifying criteria are met.';
  const labels = supportNodes({blocks:[{text:brief,references:[ref]},{text:long,references:[ref]}]}, []).map(node=>node.label);
  assert.deepEqual(labels,[brief,ref.title]);
});
