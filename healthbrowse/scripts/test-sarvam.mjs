// Opt-in synthetic staging smoke test. Never accepts keys or cases on the CLI.
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runSarvamEvaluation} from '../server/sarvam-evaluation.mjs';

export const sarvamHelp=`HealthBrowse Sarvam synthetic evaluation

Usage: node scripts/test-sarvam.mjs [--run-alternative] [--out=qa-results/sarvam-report.json]

Set SARVAM_API_KEY through the environment or secret manager. Never pass it as an argument.
By default, fetch the model catalog and compare the exact three current DeepSeek checkpoint IDs.
--run-alternative evaluates deepseekv4.1-flash-1017, a DIFFERENT model from the current R1 distill/V3.2 models.
The opt-in test may consume API credits: at most six completions (three synthetic cases, generation plus review),
at most 1,600 output tokens per call, no automatic retries, no model substitution or provisioning.
Only fixed synthetic source passages are submitted. No patient data, production changes or medical validation.
Missing key produces a not-run report and a nonzero exit code without contacting Sarvam.
`;

export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length===1&&['--help','-h'].includes(args[0])){console.log(sarvamHelp);return 0}
 let runAlternative=false,out='qa-results/sarvam-report.json';
 for(const argument of args){
  if(argument==='--run-alternative')runAlternative=true;
  else if(argument.startsWith('--out=')&&argument.slice(6))out=argument.slice(6);
  else{console.log(JSON.stringify({status:'not_run',reason:'invalid_arguments',completionCalls:0,catalogCalls:0}));return 2}
 }
 const report=await runSarvamEvaluation({key:env.SARVAM_API_KEY,runAlternative});
 try{const path=resolve(out);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600})}
 catch{console.log(JSON.stringify({status:'failed',reason:'report_write_failed',evaluationStatus:report.status,completionCalls:report.completionCalls}));return 1}
 console.log(JSON.stringify(report,null,2));
 return ['catalog_only','passed_mechanical_checks'].includes(report.status)?0:1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().then(code=>{process.exitCode=code}).catch(()=>{console.log(JSON.stringify({status:'failed',reason:'evaluation_failed'}));process.exitCode=1});
}
