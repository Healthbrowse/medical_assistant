// Run from any directory with Node 24. No model service or npm packages.
import {createHash, randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {actions, features, pickAction, planQuestion, policyVersion, prepareCorpus} from '../../dist/cardio-planner.js';
import {assignItem,reviewSession} from '../../dist/cardio-assignment.js';
import {heartIntent} from '../../dist/heart-visual.js';

const local=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const json=name=>JSON.parse(local('../../dist/'+name));
const corpus=prepareCorpus(json('education-sources.json'),json('education-figures.json'),json('cardio-figure-index.json'));
const tsv=local('questions.tsv');
const digest=s=>createHash('sha256').update(s).digest('hex');
const study=digest([policyVersion,tsv,...['cardio-artifacts.js','cardio-assignment.js','cardio-pilot.js','cited-diagram.js','response-mode.js','cardio-planner.js','cardio-answer.js','heart-visual.js','cardio-figure-index.json',
  'education-sources.json','education-figures.json'].map(n=>local('../../dist/'+n))].join('\n'));
const cases=[];
for(const line of tsv.trim().split('\n').filter(s=>!s.startsWith('#'))){
  const [split,family,target,...questions]=line.split('\t');
  if(!['train','test'].includes(split)||!actions.includes(target)||questions.length!==4) throw Error('Invalid family '+family);
  for(const [i,question] of questions.entries()) for(const role of ['General','Clinicians']){
    cases.push({id:family+'-'+i+'-'+role,question,role,split,family,target,plan:planQuestion(question,role,corpus)});
  }
}
if(new Set(cases.map(c=>c.id)).size!==cases.length || new Set(cases.map(c=>c.question.toLowerCase())).size*2!==cases.length) throw Error('Duplicate study item');
const lookup=new Map(cases.map(c=>[c.id,c]));
const casebook={study,items:cases.map(({id,question,role,plan})=>({id,question,role,eligible:plan.eligible}))};
function baseline(c){
  const intent=heartIntent(c.question);
  if(intent==='clarify') return 'clarify';
  if(intent==='flow') return 'diagram';
  if(['chambers','valves'].includes(intent)) return 'illustration';
  return 'text'; // no dedicated heart visual from the old heart router
}
// Ablation: identical corpus, query normalization and eligibility; no learned weights.
function guardedRules(c){
  const p=c.plan;
  return ['clarify','diagram','illustration'].find(a=>p.eligible.includes(a))||'text';
}
function train(logs,provenance){
  const weights=Object.fromEntries(actions.map(a=>[a,features.map(()=>0)]));
  const trainLogs=logs.filter(r=>r.c.split==='train');
  if(actions.some(a=>!trainLogs.some(row=>row.action===a))) throw Error('Need training feedback covering every action');
  // Fit each action's expected one-step reward with inverse-propensity weighted ridge regression.
  for(const action of actions){
    const rows=trainLogs.filter(r=>r.action===action);
    const mass=rows.reduce((s,r)=>s+1/r.p,0);
    const w=weights[action];
    for(let iteration=0;iteration<1000;iteration++){
      const grad=w.map(weight=>0.015*weight);
      for(const {c,reward,p} of rows){
        const x=c.plan.x,err=w.reduce((v,weight,i)=>v+weight*x[i],0)-reward;
        for(let i=0;i<w.length;i++) grad[i]+=err*x[i]/(p*mass);
      }
      for(let i=0;i<w.length;i++) w[i]-=0.15*grad[i];
    }
    weights[action]=w.map(v=>Number(v.toFixed(8)));
  }
  return {version:policyVersion,study,training:provenance,trainingDecisions:trainLogs.length,features,weights};
}
function designMetrics(items,choose){
  const counts=Object.fromEntries(actions.map(a=>[a,{count:0,matched:0}]));
  let matched=0,unwantedVisuals=0,missedVisuals=0;
  const visual=a=>['illustration','diagram'].includes(a);
  for(const c of items){
    const a=choose(c);
    counts[c.target].count++;
    if(a===c.target){matched++; counts[c.target].matched++}
    if(visual(a)&&!visual(c.target)) unwantedVisuals++;
    if(!visual(a)&&visual(c.target)) missedVisuals++;
  }
  return {decisions:items.length,matched,accuracy:matched/items.length,unwantedVisuals,missedVisuals,byAction:counts};
}
function offPolicy(rows,choose){
  if(!rows.length)return {decisions:0};
  let sum=0,sumW=0,sumW2=0,matched=0,unsupported=0;
  for(const r of rows){
    const a=choose(r.c);
    if(!r.c.plan.eligible.includes(a)) unsupported++;
    if(a!==r.action)continue;
    matched++;const w=1/r.p;
    sum+=w*r.reward;sumW+=w;sumW2+=w*w;
  }
  return {decisions:rows.length,matched,unsupported,ips:unsupported||!matched?null:sum/rows.length,effectiveSampleSize:sumW2?sumW*sumW/sumW2:0};
}
const serialize=(path,data)=>writeFileSync(resolve(path),JSON.stringify(data,null,2)+'\n');
const [command,out,...inputs]=process.argv.slice(2);
if(!out) throw Error('Use assign FILE, smoke MODEL REPORT, or fit MODEL REPORT FEEDBACK...');
if(command==='casebook'){
  serialize(out,casebook);
}else if(command==='assign'){
  const seed=randomBytes(16).toString('hex');
  serialize(out,await reviewSession(casebook,seed));
}else if(command==='smoke'||command==='fit'){
  const [reportPath,...files]=inputs;
  if(!reportPath)throw Error('Provide a report filename');
  let logs=[],provenance;
  if(command==='smoke'){
    provenance='synthetic-design-reward';
    logs=await Promise.all(cases.map(async c=>{
      const row=await assignItem({...c,eligible:c.plan.eligible},'smoke-42');
      return {...row,c,reward:row.action===c.target?1:-1};
    }));
  }else{
    provenance='reviewer-rated';
    if(!files.length)throw Error('Supply reviewer exports');
    const seen=new Set();
    for(const file of files){
      const data=JSON.parse(readFileSync(file,'utf8'));
      if(data.study!==study || !/^[a-f0-9]{32}$/.test(data.seed)||!Array.isArray(data.ratings)) throw Error('Incompatible study export');
      const assigned=new Map((await reviewSession(casebook,data.seed)).items.map(i=>[i.id,i]));
      for(const row of data.ratings){
        const c=lookup.get(row.id);
        if(!c)throw Error('Unknown study item');
        const expected=assigned.get(c.id),key=data.seed+':'+c.id;
        if(!expected||seen.has(key)||row.action!==expected.action||row.p!==expected.p)throw Error('Duplicate or altered assignment');
        if(![row.relevance,row.support,row.agreement].every(v=>v===0||v===1))throw Error('Incomplete rating');
        seen.add(key);
        // A factual support or cross-modal agreement failure outweighs a relevant topic.
        const reward=row.support&&row.agreement?(row.relevance?1:0):-1;
        logs.push({...expected,c,reward});
      }
    }
  }
  const policy=train(logs,provenance), select=c=>pickAction(c.plan,policy);
  const report={study,provenance,questions:cases.length/2,families:new Set(cases.map(c=>c.family)).size,
    trainFamilies:[...new Set(cases.filter(c=>c.split==='train').map(c=>c.family))],
    testFamilies:[...new Set(cases.filter(c=>c.split==='test').map(c=>c.family))],roles:{}};
  for(const role of ['General','Clinicians']){
    const test=cases.filter(c=>c.role===role&&c.split==='test');
    const ratings=logs.filter(r=>r.c.role===role&&r.c.split==='test');
    report.roles[role]={designTargets:{fixed:designMetrics(test,baseline),samePlannerRules:designMetrics(test,guardedRules),candidate:designMetrics(test,select)}};
    if(command==='fit')report.roles[role].reviewerReward={fixed:offPolicy(ratings,baseline),samePlannerRules:offPolicy(ratings,guardedRules),candidate:offPolicy(ratings,select)};
  }
  serialize(out,policy);serialize(reportPath,report);
}else throw Error('Unknown command');
