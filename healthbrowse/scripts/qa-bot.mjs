import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {modelAPI} from '../server/model-api.mjs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';
import {auditResponse,compareModes,reportMarkdown} from '../qa/audit-response.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const cases=JSON.parse(readFileSync(new URL('../qa/cases.json',import.meta.url))).filter(c=>!args.case||c.id===args.case);
if(!cases.length)throw Error('No matching QA case. Check qa/cases.json.');
const limit=Math.max(1,Math.min(100,Number(args.limit)||cases.length*2));
const target=args.target?new URL(args.target):null;
if(target&&(target.protocol!=='https:'||target.username||target.password||target.search||target.hash))throw Error('Use an HTTPS site origin without credentials or query parameters.');
const auth=process.env.HEALTHBROWSE_QA_ACCESS_TOKEN;
if(target&&!auth)throw Error('Remote testing requires HEALTHBROWSE_QA_ACCESS_TOKEN for a dedicated test account.');
const provider=process.env.MODEL_PROVIDER||(process.env.GROQ_API_KEY&&!process.env.HF_TOKEN?'groq':'deepseek');
if(!target&&!['deepseek','groq'].includes(provider))throw Error('Use deepseek or groq for a local provider test.');
const secretName=provider==='deepseek'?'HF_TOKEN':'GROQ_API_KEY';
async function keyFromSecret(){
 if(process.env[secretName])return process.env[secretName];
 if(!process.stdin.isTTY)throw Error(secretName+' must come from the server secret manager.');
 process.stdin.setRawMode(true);process.stdout.write(secretName+' (hidden): ');
 return new Promise(resolve=>{let key='';const read=d=>{for(const c of d.toString()){
  if(c==='\u0003')process.exit(130);
  if(c==='\n'||c==='\r'){process.stdin.off('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(key);return;}key+=c;
 }};process.stdin.on('data',read);});
}
const key=target?null:await keyFromSecret();
const assets=Object.fromEntries(['medline-topics','clinical-passages','grounded-sources','education-sources','topic-list'].map(n=>['/'+n+'.json',{text:readFileSync(new URL('../dist/'+n+'.json',import.meta.url),'utf8')}]));
const DB=target?null:openWorkspace(':memory:');
if(DB)for(const e of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url))).entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
const realFetch=globalThis.fetch;
if(!target)globalThis.fetch=(url,options)=>url==='https://auth.example/auth/v1/user'?Promise.resolve(Response.json({id:'11111111-1111-4111-8111-111111111111'})):realFetch(url,options);
const env={DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'fixture',MODEL_PROVIDER:provider,[secretName]:key,DEEPSEEK_GENERAL_MODEL:process.env.DEEPSEEK_GENERAL_MODEL,DEEPSEEK_CLINICIAN_MODEL:process.env.DEEPSEEK_CLINICIAN_MODEL};
const records=[];
const matrix=cases.flatMap(testCase=>['General','Clinicians'].map(role=>({testCase,role}))).slice(0,limit);
const spacing=Math.max(0,Math.min(120000,Number(args['spacing-ms']??45000)));
for(const {testCase,role} of matrix){
 if(records.length&&spacing)await new Promise(r=>setTimeout(r,spacing));
 const body={topic:testCase.topic,question:testCase.question,searchQuery:testCase.searchQuery||testCase.question,mode:testCase.mode,deck:testCase.deck,role};
 if(testCase.mode==='chat'){
  const preceding=records.findLast(r=>r.role===role&&r.testCase.topic===testCase.topic&&r.testCase.mode==='search'&&r.result.answer);
  if(preceding){body.browserContext=preceding.result.answer.text.slice(0,1200);body.history=[preceding.testCase.question];}
 }
 const request=new Request((target?.origin||'https://site.test')+'/api/ai/answer',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(auth||'fixture-session-12345')},body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
 const start=Date.now();let response,result;
 try{response=target?await realFetch(request):await modelAPI(request,env,assets);result=await response.json();}
 catch{response={status:503};result={code:'transport_failure',status:'unavailable'};}
 const elapsedMs=Date.now()-start,audit=auditResponse(testCase,role,response.status,result,elapsedMs);
 records.push({testCase,role,status:response.status,elapsedMs,result,audit});
 console.log(JSON.stringify({case:testCase.id,role,status:response.status,passed:audit.passed,findings:audit.findings}));
}
DB?.close();
const comparisons=compareModes(records),report={createdAt:new Date().toISOString(),execution:target?'Published API with dedicated test-account session':'Live '+provider+' provider through local gateway with a test identity',records,comparisons,
 summary:{passed:records.filter(r=>r.audit.passed).length,reviewFindings:records.reduce((n,r)=>n+r.audit.findings.filter(f=>f.severity==='review').length,comparisons.length)}};
const out=resolve(args.out||'qa-results');mkdirSync(out,{recursive:true});
writeFileSync(out+'/report.json',JSON.stringify(report,null,2));writeFileSync(out+'/report.md',reportMarkdown(report));
console.log(JSON.stringify({report:out+'/report.md',summary:report.summary}));
process.exitCode=report.summary.passed===records.length?0:1;
