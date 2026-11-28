import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runModelAudit} from '../server/model-audit.mjs';

export const modelAuditHelp=`HealthBrowse bounded model audit

Usage: node scripts/audit-models.mjs [--live] [--hf-catalog]

Default: list configured browser choices, reviewers and planners without network calls.
--live: one fixed synthetic JSON completion per unique configured checkpoint, at most
12 requests and 512 output tokens per request. No automatic retries or fallback.
--live --hf-catalog: one GET to the Hugging Face router model catalog; no completions.
Provide credentials through environment variables or the secret manager, never arguments.
The local process.env has no Cloudflare AI binding: Workers routes are not_testable here.
The same runModelAudit module can run in an authenticated Worker with its real AI binding.
Reports contain safe status codes, requested model IDs, usage and timing. Raw errors,
credentials, endpoint URLs and prompts are excluded. No patient data is submitted.
A passed synthetic probe is connectivity/format evidence, not clinical approval.
`;

export async function main(args=process.argv.slice(2),env=process.env,{fetchImpl=fetch,write=value=>console.log(value)}={}){
 if(args.length===1&&['--help','-h'].includes(args[0])){write(modelAuditHelp);return 0}
 if(args.some(argument=>!['--live','--hf-catalog'].includes(argument))||new Set(args).size!==args.length){
  write(JSON.stringify({checkedAt:new Date().toISOString(),status:'not_run',code:'invalid_arguments',requests:0}));return 2;
 }
 try{
  const report=await runModelAudit({env,live:args.includes('--live'),hfCatalogOnly:args.includes('--hf-catalog'),fetchImpl});
  write(JSON.stringify(report,null,2));return ['dry_run','passed','catalog_only'].includes(report.status)?0:1;
 }catch{
  write(JSON.stringify({checkedAt:new Date().toISOString(),status:'failed',code:'audit_failed',requests:0}));return 1;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().then(code=>{process.exitCode=code}).catch(()=>{console.log(JSON.stringify({checkedAt:new Date().toISOString(),status:'failed',code:'audit_failed'}));process.exitCode=1});
}
