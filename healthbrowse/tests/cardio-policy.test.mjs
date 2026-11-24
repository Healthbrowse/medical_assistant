import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {planQuestion,prepareCorpus,pickAction} from '../dist/cardio-planner.js';
import {composeResponse,visualForAnswer} from '../dist/cardio-answer.js';
import {reviewSession} from '../dist/cardio-assignment.js';

const asset=n=>readFileSync(new URL('../dist/'+n,import.meta.url));
const json=n=>JSON.parse(asset(n));
const policy=json('cardio-policy.json'), book=json('cardio-review-cases.json');
const index=json('cardio-figure-index.json');
const corpus=prepareCorpus(json('education-sources.json'),json('education-figures.json'),index);
const cli=fileURLToPath(new URL('../inference/cardio-policy/study.mjs',import.meta.url));

test('the CPU image index belongs to the two JPEGs actually shipped to the Browser',()=>{
  for(const [id,hash] of Object.entries(index.sha256))
    assert.equal(createHash('sha256').update(asset(id+'.jpg')).digest('hex'),hash);
  assert.equal(corpus.figures.length,2);
  const p=planQuestion('Show the heart valves','General',corpus);
  assert.equal(p.figure.id,'m46676-fig-ch20_01_11');
  const swapped=structuredClone(corpus);
  swapped.index.scores.valves['m46676-fig-ch20_01_08']=1;
  assert.equal(planQuestion('Show the heart valves','General',swapped).figure.id,'m46676-fig-ch20_01_08');
});
test('only eligible visuals are displayed and citations support each arrow for both audiences',()=>{
  for(const role of ['General','Clinicians']){
    const q='Trace the pulmonary circuit of the heart';
    const p=planQuestion(q,role,corpus),response=composeResponse(q,p,pickAction(p,policy));
    assert.equal(response.action,'diagram');assert.equal(response.edges.length,2);
    assert.deepEqual(response.edges.map(e=>e.ref),response.blocks.map(b=>b.ref));
    for(const row of response.edges)assert.match(row.ref.url,/openstax\/osbooks/);
    const p2=planQuestion(q,role,{...corpus,references:[]});
    assert.deepEqual(p2.eligible,['text']);assert.equal(composeResponse(q,p2,'text').blocks.length,0);
    assert.throws(()=>composeResponse(q,p2,'diagram'));
    const p3=planQuestion(q,role,{...corpus,references:corpus.references.map(r=>({...r,sourceRevision:'other'}))});
    assert.deepEqual(p3.eligible,['text']);
  }
});
test('unreviewed contexts and explicit text preference cannot produce illustrations',()=>{
  for(const q of ['Describe the heart valves without a picture','Show fetal heart circulation','Does the left ventricle pump blood to the lungs?','Show a heart emoji'])
    assert.deepEqual(planQuestion(q,'General',corpus).eligible,['text']);
  assert.equal(pickAction(planQuestion('Heart','General',corpus),policy),'clarify');
});
test('blinded assignments, held-out partitions and fitted reviewer feedback stay separate',async t=>{
  const out=mkdtempSync(join(tmpdir(),'cardio-review-test-'));t.after(()=>rmSync(out,{recursive:true,force:true}));
  const model=join(out,'candidate.json'),report=join(out,'report.json');
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{stdio:'pipe'});
  run('smoke',model,report);
  assert.deepEqual(JSON.parse(readFileSync(model)),policy);
  assert.deepEqual(JSON.parse(readFileSync(report)),JSON.parse(readFileSync(new URL('../inference/cardio-policy/smoke-results.json',import.meta.url))));
  run('casebook',join(out,'cases.json'));assert.deepEqual(JSON.parse(readFileSync(join(out,'cases.json'))),book);
  const rep=JSON.parse(readFileSync(report));
  assert.ok(rep.testFamilies.every(f=>!rep.trainFamilies.includes(f)));
  assert.equal(rep.questions,120);
  const sessions=[];
  for(let i=0;i<12;i++){
    const seed=i.toString(16).padStart(32,'0');
    const s=await reviewSession(book,seed);
    assert.equal(s.items.length,24);assert.equal(s.items.filter(i=>i.role==='General').length,12);
    assert.equal(s.items.some(i=>'target' in i||'split' in i),false);
    const ratings=s.items.map(i=>({id:i.id,action:i.action,p:i.p,relevance:1,support:Number(i.action==='text'),agreement:1}));
    const file=join(out,'test-'+i+'.json');
    writeFileSync(file,JSON.stringify({study:s.study,seed,ratings}));sessions.push(file);
  }
  run('fit',model,report,...sessions);
  const trained=JSON.parse(readFileSync(model));
  assert.equal(trained.training,'reviewer-rated');
  assert.equal(pickAction(planQuestion('Heart','General',corpus),trained),'text');
  assert.ok(JSON.parse(readFileSync(report)).roles.General.reviewerReward.candidate.decisions>0);
  assert.throws(()=>run('fit',model,report,...sessions,sessions[0]),/Duplicate/);
  const altered=JSON.parse(readFileSync(sessions[0]));altered.ratings[0].p=0;
  writeFileSync(sessions[0],JSON.stringify(altered));
  assert.throws(()=>run('fit',model,report,...sessions),/altered/);
});

test('the live answer selection requires the displayed claim and its own pinned source',()=>{
  const q='How does the heart pump blood?', plan=planQuestion(q,'General',corpus);
  const e=plan.edges[0],claim='Blood flows from '+e.from.toLowerCase()+' to '+e.to.toLowerCase()+'.';
  const choose=(text,ref)=>visualForAnswer(q,'General',[{text,references:[ref]}],corpus,policy);
  assert.equal(choose(claim,e.ref).edges.length,1);
  assert.equal(choose('This is an unrelated passage.',e.ref).action,'text');
  assert.equal(choose(claim,{...e.ref,text:'a fabricated citation with unrelated text'}).action,'text');
  assert.equal(choose(claim,{...e.ref,sourceRevision:'unverified'}).action,'text');
  assert.equal(visualForAnswer(q,'General',[],corpus,policy).action,'text');
});
