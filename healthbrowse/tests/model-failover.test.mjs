import test from 'node:test';
import assert from 'node:assert/strict';
import {withModelFallback} from '../server/model-failover.mjs';

test('provider timeout or network failure can switch, cancellation and content refusals cannot',async()=>{
 const primary={},backup={};
 for(const condition of ['timeout','network','rate-limit','blocked','cancel']){
  let count=0;
  const caller=new AbortController();
  const run=async(config,signal)=>{
   count++;
   if(config===primary){
    if(condition==='timeout')await new Promise((resolve,reject)=>{
     const handle=setTimeout(resolve,1000);
     signal.addEventListener('abort',()=>{clearTimeout(handle);reject(signal.reason);},{once:true});
    });
    if(condition==='network')throw new TypeError('offline');
    if(condition==='cancel'){caller.abort();throw caller.signal.reason;}
    if(condition==='rate-limit')return {response:new Response(null,{status:429})};
    if(condition==='blocked')return {response:Response.json({error:'content_policy_violation'},{status:400})};
   }
   return {response:new Response(null,{status:200})};
  };
  const attempt=withModelFallback(primary,backup,caller.signal,5,run);
  if(condition==='cancel')await assert.rejects(attempt,{name:'AbortError'});
  else assert.equal((await attempt).config,condition==='blocked'?primary:backup);
  assert.equal(count,['cancel','blocked'].includes(condition)?1:2);
 }
});
