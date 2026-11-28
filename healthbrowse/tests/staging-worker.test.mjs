import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {stagingArguments} from '../scripts/staging-worker.mjs';

const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
// A synthetic UUID used only to check offline configuration validation.
const valid=()=>{
 const value=structuredClone(config);
 value.env.staging.d1_databases=[{binding:'DB',database_name:'healthbrowse-staging',database_id:'11111111-2222-4333-8444-555555555555',migrations_dir:'drizzle'}];
 return value;
};

test('unprovisioned staging is blocked while production and existing preview bindings are preserved',()=>{
 assert.equal(config.name,'healthbrowse-ai');
 assert.equal(config.env.staging.name,'staging-healthbrowse-ai');
 assert.equal(config.d1_databases[0].database_id,'7a93c3e9-2b79-4009-80b1-418e0350bcf1');
 assert.equal(config.previews.d1_databases[0].database_id,'9ef3126c-c6fe-4571-ae39-78136741b970');
 const unconfigured=structuredClone(config);unconfigured.env.staging.d1_databases=[];
 assert.throws(()=>stagingArguments(['deploy'],unconfigured),/create the dedicated healthbrowse-staging D1 database/);
});

test('staging refuses production or shared-preview databases and invalid IDs',()=>{
 for(const id of [config.d1_databases[0].database_id,config.previews.d1_databases[0].database_id]){
  const value=valid();value.env.staging.d1_databases[0].database_id=id;
  assert.throws(()=>stagingArguments(['deploy'],value),/separate from production/);
 }
 for(const id of ['', 'replace-me', '00000000-0000-0000-0000-000000000000']){
  const value=valid();value.env.staging.d1_databases[0].database_id=id;
  assert.throws(()=>stagingArguments(['deploy'],value),/actual database UUID/);
 }
});

test('each staging action constructs its own fixed environment, config and database arguments',()=>{
 assert.deepEqual(stagingArguments(['check'],valid()),[]);
 assert.deepEqual(stagingArguments(['deploy'],valid()),['deploy','--config','wrangler.jsonc','--env','staging']);
 for(const [action,verb] of [['migrations-list','list'],['migrations-apply','apply']])
  assert.deepEqual(stagingArguments([action],valid()),['d1','migrations',verb,'healthbrowse-staging','--remote','--config','wrangler.jsonc','--env','staging']);
});

test('extra flags and a different Workers Builds name override cannot retarget staging',()=>{
 for(const args of [[],['production'],['deploy','--env','production'],['deploy','--config','other.json'],['deploy','--name','healthbrowse-ai']])
  assert.throws(()=>stagingArguments(args,valid()),/Additional flags are not accepted/);
 for(const name of ['healthbrowse-ai','healthbrowse-ai-staging','other-worker'])
  assert.throws(()=>stagingArguments(['deploy'],valid(),{WRANGLER_CI_OVERRIDE_NAME:name}),/different Worker/);
 assert.deepEqual(stagingArguments(['deploy'],valid(),{WRANGLER_CI_OVERRIDE_NAME:'staging-healthbrowse-ai',CLOUDFLARE_ENV:'production'}),
  ['deploy','--config','wrangler.jsonc','--env','staging']);
});

test('staging rejects route inheritance, changed provider, wrong binding and wrong migration directory',()=>{
 for(const mutate of [
  stage=>{stage.name='healthbrowse-ai-staging'},
  stage=>{delete stage.routes},stage=>{stage.routes=['production.example/*']},
  stage=>{stage.vars.MODEL_PROVIDER='deepseek'},stage=>{delete stage.ai},
  stage=>{stage.d1_databases[0].binding='OTHER'},stage=>{stage.d1_databases[0].migrations_dir='migrations'}
 ]){
  const value=valid();mutate(value.env.staging);assert.throws(()=>stagingArguments(['deploy'],value));
 }
});

test('deployment CLI rejects extra flags before Wrangler or network access',()=>{
 const script=new URL('../scripts/staging-worker.mjs',import.meta.url);
 const result=spawnSync(process.execPath,[script.pathname,'deploy','--env','production'],{encoding:'utf8',env:{...process.env,WRANGLER_CI_OVERRIDE_NAME:''}});
 assert.equal(result.status,1);assert.match(result.stderr,/Additional flags are not accepted/);
 assert.equal(result.stdout,'');
});
