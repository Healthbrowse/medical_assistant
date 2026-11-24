import test from 'node:test';
import assert from 'node:assert/strict';
import {browserConfig,buddyModelNames} from '../server/public-config.mjs';
test('the public configuration never exposes service secrets',()=>{
 const y=key=>browserConfig({SUPABASE_URL:'https://demo.supabase.co',SUPABASE_ANON_KEY:key}).supabaseAnonKey;
 assert.equal(y('sb_secret_example'),'');assert.equal(y('a.'+btoa('{"role":"service_role"}')+'.b'),'');
 assert.equal(y('sb_publishable_example'),'sb_publishable_example');
});

test('public Buddy choices match the selectable model IDs and exclude credentials and invalid overrides',()=>{
 const general='deepseek-ai/DeepSeek-R1-Distill-Llama-8B',professional='deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',groq='openai/gpt-oss-120b';
 const env={MODEL_PROVIDER:'groq',HF_TOKEN:'private',GROQ_API_KEY:'private',GROQ_MODEL:'openai/gpt-oss-20b'};
 assert.deepEqual(buddyModelNames(env),{general,professional,groq});
 const override='deepseek-ai/DeepSeek-R1-Distill-Qwen-14B';
 assert.deepEqual(buddyModelNames({...env,HF_TOKEN:'',DEEPSEEK_CLINICIAN_MODEL:override}),{general,professional:override,groq});
 assert.deepEqual(buddyModelNames({...env,DEEPSEEK_GENERAL_MODEL:'invalid-private-value'}),{general:null,professional,groq});
});
