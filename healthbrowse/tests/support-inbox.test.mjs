import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';
import {accountAPI} from '../server/account-api.mjs';
const user={id:'11111111-1111-4111-8111-111111111111'};
function fixture(t){
 const DB=openWorkspace(':memory:');for(const e of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url))).entries)DB.exec(readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));t.after(()=>DB.close());
 const env={DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'fixture'};
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'https://auth.example/auth/v1/user');return Response.json(user)});
 const call=(kind,body,token='fixture')=>accountAPI(new Request('https://site.test/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env);
 return {DB,env,call};
}
test('feedback persists, classifies corrections for review, and retries without duplicate rows',async t=>{
 const {DB,call}=fixture(t),body={message:'The citation is incorrect, thanks.',category:'general',requestId:crypto.randomUUID()};
 for(let i=0;i<2;i++){const r=await call('feedback',body);assert.equal(r.status,201);const result=await r.json();assert.equal(result.feedback.type,'source-correction');assert.equal(result.feedback.reviewStatus,'pending');}
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM hb_support_requests').bind().first()).n,1);
 assert.equal((await call('feedback',{...body,message:'A changed message'})).status,409);
 assert.equal((await call('feedback',{...body,user_id:'other'})).status,400);
 assert.equal((await call('feedback',body,null)).status,401);
});
test('contact is received without an email provider and does not claim email delivery',async t=>{
 const {DB,call}=fixture(t),body={name:'Demo User',email:'demo@example.test',message:'I would like to discuss a research collaboration.',requestId:crypto.randomUUID()};
 const result=await (await call('contact',body)).json();assert.equal(result.status,'received');assert.equal(result.delivery,'not_configured');
 const row=await DB.prepare('SELECT * FROM hb_support_requests WHERE id=?').bind(body.requestId).first();assert.equal(row.email,body.email);assert.equal(row.user_id,user.id);assert.equal(row.status,'received');
 assert.equal((await call('contact',{...body,email:'invalid'})).status,400);
 assert.equal((await call('contact',{...body,message:'Patient name: Someone'})).status,400);
});
test('support submission limit is enforced in storage and identity is not client supplied',async t=>{
 const {call}=fixture(t);
 for(let i=0;i<10;i++)assert.equal((await call('feedback',{message:'A useful interface suggestion '+i,requestId:crypto.randomUUID()})).status,201);
 assert.equal((await call('feedback',{message:'One more',requestId:crypto.randomUUID()})).status,429);
});
test('configured contact forwarding has a fixed recipient and a stable idempotency key',async t=>{
 const {env,call}=fixture(t);Object.assign(env,{RESEND_API_KEY:'test-key',CONTACT_FROM:'desk@example.test',CONTACT_TO:'team@example.test'});let sends=0;
 t.mock.method(globalThis,'fetch',async (url,options)=>{if(url==='https://auth.example/auth/v1/user')return Response.json(user);assert.equal(url,'https://api.resend.com/emails');const b=JSON.parse(options.body);assert.deepEqual(b.to,['team@example.test']);assert.equal(b.reply_to,'demo@example.test');assert.match(options.headers['Idempotency-Key'],/^hb-contact\//);sends++;return Response.json({id:'provider-receipt'})});
 const body={name:'Demo',email:'demo@example.test',message:'A platform question.',requestId:crypto.randomUUID()};
 for(let i=0;i<2;i++)assert.equal((await (await call('contact',body)).json()).status,'sent');assert.equal(sends,1);
});
