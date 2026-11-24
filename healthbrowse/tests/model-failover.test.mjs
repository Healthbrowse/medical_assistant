import test from 'node:test';
import assert from 'node:assert/strict';
import {withModelFallback} from '../server/model-failover.mjs';

test('provider timeout or network failure can switch, cancellation and content refusals cannot',async()=>{
 const primary={},backup={};
 for(const condition of ['timeout','network','rate-limit','permission','blocked','blocked-permission','cancel']){
  let count=0;
  const switches=[];
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
    if(condition==='permission')return {response:Response.json({error:'This token does not have sufficient permissions to call Inference Providers.'},{status:403})};
    if(condition==='blocked-permission')return {response:Response.json({error:'Content policy refusal: permission to call inference providers denied.'},{status:403})};
    if(condition==='blocked')return {response:Response.json({error:'content_policy_violation'},{status:400})};
   }
   return {response:new Response(null,{status:200})};
  };
  const attempt=withModelFallback(primary,backup,caller.signal,5,run,detail=>switches.push(detail));
  const expected={timeout:{reason:'timeout'},network:{reason:'network_error'},'rate-limit':{reason:'upstream_http',httpStatus:429},permission:{reason:'upstream_http',httpStatus:403}}[condition];
  if(condition==='cancel')await assert.rejects(attempt,{name:'AbortError'});
  else assert.equal((await attempt).config,expected?backup:primary);
  assert.equal(count,expected?2:1);
  assert.deepEqual(switches,expected?[expected]:[]);
 }
});
