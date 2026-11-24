import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heartIntent, heartFigures, citedHeartFlow} from '../dist/heart-visual.js';
import {classifyResponseMode, screenGeneralQuery} from '../dist/response-mode.js';
import {clarifyQuery} from '../dist/query-understanding.js';
import {visualLookupEndpoint} from '../dist/result-enrichment.js';
import {educationalVisual, medicalFigureResponse, educationImage} from '../server/education-visuals.mjs';
import {addEducation, educationEvidence} from '../server/education-evidence.mjs';
import {prepareCited, presentCited} from '../server/model-cited.mjs';

const assets = {};
for (const name of ['education-sources','education-figures']) {
  assets['/'+name+'.json'] = {text: readFileSync(new URL('../dist/'+name+'.json',import.meta.url),'utf8')};
}
const chambers = 'What are the chambers of the human heart?';
const pump = 'How does the heart pump blood?';

test('Browser clarifies a bare organ and routes all three choices to medical search', () => {
  for (const q of ['heart','Human heart','the heart?']) {
    assert.equal(classifyResponseMode(q), 'medical');
    const options = clarifyQuery(q,{browser:true}).choices;
    assert.deepEqual(options.map(o=>heartIntent(o.query)), ['chambers','flow','conditions']);
    for (const o of options) {
      assert.equal(classifyResponseMode(o.query),'medical');
      assert.equal(clarifyQuery(o.query,{browser:true}),null);
    }
  }
  assert.equal(clarifyQuery('heart',{browser:false}),null);
  for (const q of ['the heart of the city','heart emoji','what is a heart of gold?']) {
    assert.equal(classifyResponseMode(q),'general');
  }
  assert.equal(screenGeneralQuery('I have crushing chest pain and cannot breathe').status,'emergency');
});

test('normal circulation templates stay specific to the requested subject', () => {
  const expected = new Map([
    ['Trace blood flow through the human heart','flow'], ['Describe the heart chambers','chambers'],
    ['Where are the heart valves located?','valves'], ['Explain blood flow in the fetal heart',null],
    ['How does heart failure affect blood flow?',null], ['How does the heart pump after valve replacement?',null],
    ['Trace the coronary circulation of the heart',null], ['How does a heart-lung machine pump blood?',null],
    ['How does the heart pump blood and what is my risk?',null]
  ]);
  for (const [q,intent] of expected) assert.equal(heartIntent(q),intent,q);
});

test('both audience prompts get pinned evidence and only final cited passages create arrows', () => {
  for (const role of ['General reader','Medical professional']) {
    const input = {role, question:pump, topic:'Heart', mode:'search', deck:0};
    const evidence = addEducation(null,educationEvidence(assets,input),input);
    const prepared = prepareCited(input,evidence);
    const refs = prepared.evidence.sources.slice(0,2);
    assert.deepEqual(refs.map(r=>r.sourceParagraph),['fs-id2175356','fs-id1236860']);
    const source = refs[0];
    const claim = {text:'Blood returns to the right atrium and passes to the right ventricle.',
      sources:[source.id], section:'synthesis', quotes:[source.text.split('. ')[1]+'.']};
    const result = presentCited({answer:[claim],supportReview:'completed'},prepared,input,'test-fixture');
    const cited = result.answer.blocks.flatMap(b=>b.references||[]);
    assert.ok(cited.some(r=>r.sourceParagraph===source.sourceParagraph));
    assert.equal(citedHeartFlow(cited,false).length,2);
    const rows = citedHeartFlow(refs,role==='Medical professional');
    assert.equal(rows.length,6);
    assert.deepEqual(rows.map(r=>[r.from,r.to]),role==='Medical professional'?[
      ['Systemic veins','Right atrium'],['Right atrium','Right ventricle'],['Right ventricle','Pulmonary capillaries'],
      ['Pulmonary veins','Left atrium'],['Left atrium','Left ventricle'],['Left ventricle','Systemic arteries']
    ]:[
      ['Body','Right atrium'],['Right atrium','Right ventricle'],['Right ventricle','Lungs'],
      ['Lungs','Left atrium'],['Left atrium','Left ventricle'],['Left ventricle','Body']
    ]);
    for (const change of [{url:'https://example.org'},{sourceRevision:'main'},{text:'Unsupported.'},{sourceParagraph:'other'}]) {
      assert.deepEqual(citedHeartFlow(refs.map(r=>({...r,...change})),false),[]);
    }
    assert.deepEqual(citedHeartFlow([],false),[]);
    assert.equal(educationalVisual(assets,input),null);
    assert.equal(visualLookupEndpoint({mode:'medical',topic:'Heart',query:pump}),'');
  }
});

test('image resolution agrees with the answer request and never sends the original question to the figure service', async () => {
  for (const [question,intent] of [[chambers,'chambers'],['Show the valves of the heart','valves']]) {
    const input = {mode:'search',topic:'Heart',question};
    const figure = educationalVisual(assets,input);
    assert.equal(figure.id,heartFigures[intent]);
    const url = visualLookupEndpoint({mode:'medical',topic:'Heart',query:question});
    assert.equal(url,'/api/browser/medical-figure?topic=Heart&intent='+intent);
    const request = new Request(new URL(url,'https://test.example'));
    const offline = ()=>assert.fail('unexpected external lookup');
    assert.equal((await (await medicalFigureResponse(request,assets,offline)).json()).visual.id,figure.id);
    assert.deepEqual((await (await medicalFigureResponse(request,{},offline)).json()).visuals,[]);
    assert.equal(visualLookupEndpoint({mode:'medical',topic:'Heart',query:question,allowLookup:false}),'');
  }
  const invalid=medicalFigureResponse(new Request('https://test.example/api/browser/medical-figure?topic=Heart&intent=unknown'),assets);
  assert.equal(invalid.status,400);
});

test('the Worker serves both licensed anatomy images with external requests disabled', async t => {
  t.mock.method(globalThis,'fetch',()=>assert.fail('anatomy image reached the network'));
  for (const id of Object.values(heartFigures)) {
    const bytes = readFileSync(new URL('../dist/'+id+'.jpg',import.meta.url));
    const local = {...assets,['/'+id+'.jpg']:{base64:true,type:'image/jpeg',text:bytes.toString('base64')}};
    const response = await educationImage(new Request('https://test.example/api/education-image?id='+id),local);
    assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }
});
