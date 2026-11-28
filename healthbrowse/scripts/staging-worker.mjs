// These commands target only the persistent staging Worker. No arbitrary
// Wrangler flags are forwarded, and no database is created by this script.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const workerName='healthbrowse-ai-staging',databaseName='healthbrowse-staging';
const actions=new Set(['check','deploy','migrations-list','migrations-apply']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class StagingConfigurationError extends Error {}
const refuse=message=>{throw new StagingConfigurationError(message)};

export function stagingArguments(args,config,buildEnv={}){
 if(args.length!==1||!actions.has(args[0]))refuse('Use exactly one staging action: check, deploy, migrations-list, or migrations-apply. Additional flags are not accepted.');
 if(buildEnv.WRANGLER_CI_OVERRIDE_NAME&&buildEnv.WRANGLER_CI_OVERRIDE_NAME!==workerName)
  refuse('This build is connected to a different Worker. Connect the staging command to healthbrowse-ai-staging only.');
 const staging=config?.env?.staging;
 if(config?.name!=='healthbrowse-ai'||staging?.name!==workerName)
  refuse('Expected production healthbrowse-ai and a separate env.staging named healthbrowse-ai-staging.');
 if(!Array.isArray(staging.routes)||staging.routes.length||staging.workers_dev!==true)
  refuse('Staging must use its own workers.dev address with an explicit empty routes array.');
 if(staging.vars?.MODEL_PROVIDER!=='sarvam'||staging.vars?.SARVAM_MODEL!=='deepseekv4.1-flash-1017'||staging.ai?.binding!=='AI')
  refuse('Staging must explicitly configure the tested Sarvam Flash checkpoint and AI binding.');
 const bindings=staging.d1_databases;
 if(!Array.isArray(bindings)||bindings.length!==1)
  refuse('Staging is not configured: create the dedicated healthbrowse-staging D1 database and add its returned DB binding under env.staging. See docs/cloudflare-staging.md.');
 const db=bindings[0];
 if(db.binding!=='DB'||db.database_name!==databaseName||db.migrations_dir!=='drizzle'||!uuid.test(db.database_id||'')||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id))
  refuse('Staging DB must name healthbrowse-staging, use its actual database UUID, bind as DB, and set migrations_dir to drizzle.');
 const shared=[...(config.d1_databases||[]),...(config.previews?.d1_databases||[])];
 if(shared.some(other=>String(other.database_id||'').toLowerCase()===db.database_id.toLowerCase()||other.database_name===db.database_name))
  refuse('Staging must use a dedicated database, separate from production and the existing preview database.');
 if(args[0]==='check')return [];
 const command=args[0]==='deploy'?['deploy']:['d1','migrations',args[0]==='migrations-list'?'list':'apply',databaseName,'--remote'];
 return [...command,'--config','wrangler.jsonc','--env','staging'];
}

export function main(args=process.argv.slice(2)){
 if(args.length===1&&['--help','-h'].includes(args[0])){
  console.log('Usage: node scripts/staging-worker.mjs <check|deploy|migrations-list|migrations-apply>\nRequires a dedicated staging D1 binding. Wrangler targets are fixed to --env staging; extra flags are rejected. Runtime credentials are configured separately.');
  return 0;
 }
 try{
  // Keep the tracked JSONC file valid JSON; parsing never evaluates code.
  const config=JSON.parse(readFileSync(resolve(appRoot,'wrangler.jsonc'),'utf8'));
  const command=stagingArguments(args,config,process.env);
  if(!command.length){console.log('Staging configuration checks passed. Cloudflare resource access and runtime credentials have not been verified.');return 0}
  const expected=JSON.parse(readFileSync(resolve(appRoot,'package.json'),'utf8')).devDependencies?.wrangler;
  let installed;
  try{installed=JSON.parse(readFileSync(resolve(appRoot,'node_modules/wrangler/package.json'),'utf8')).version}
  catch{refuse('The pinned local Wrangler is missing. Run npm ci before using a staging deployment command.')}
  if(!/^\d+\.\d+\.\d+$/.test(expected||'')||installed!==expected)
   refuse('The installed Wrangler does not match the exact package pin. Run npm ci before deploying.');
  const result=spawnSync(process.execPath,[resolve(appRoot,'node_modules/wrangler/bin/wrangler.js'),...command],{
   cwd:appRoot,env:process.env,stdio:'inherit',shell:false
  });
  if(result.error)refuse('Wrangler could not start. No deployment was confirmed.');
  return Number.isInteger(result.status)?result.status:1;
 }catch(error){
  console.error(error instanceof StagingConfigurationError?error.message:'Staging configuration could not be read. Keep wrangler.jsonc valid JSON and follow docs/cloudflare-staging.md.');
  return 1;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=main();
