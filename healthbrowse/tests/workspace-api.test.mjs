import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accountAPI} from '../server/account-api.mjs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';
const users={a:{id:'11111111-1111-4111-8111-111111111111',email:'a@example.test',user_metadata:{full_name:'Researcher A'}},b:{id:'22222222-2222-4222-8222-222222222222',email:'b@example.test'}};
const sessions={a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a2:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',b:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
const tokenFor=key=>{const owner=key==='b'?'b':'a';return 'e30.'+Buffer.from(JSON.stringify({sub:key==='mismatch'?users.b.id:users[owner].id,session_id:key==='missing'?undefined:sessions[key==='refresh'?'a':key],iat:key==='refresh'?2:1})).toString('base64url')+'.fixture'};
const verifiedTokens=new Map(['a','a2','b','refresh','missing','mismatch'].map(k=>[tokenFor(k),users[k==='b'?'b':'a']]));
const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url)));
function fixture(t){
 const DB=openWorkspace(':memory:');for(const entry of journal.entries)DB.exec(readFileSync(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
 t.after(()=>DB.close());t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://auth.example/auth/v1/user');const user=verifiedTokens.get(options.headers.Authorization.slice(7));return user?Response.json(user):Response.json({error:'invalid'},{status:401});
 });
 const env={DB,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public'};
 const call=(path,method='GET',body,token='a')=>accountAPI(new Request('https://site.test/api/me/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token==='invalid'?'invalid':tokenFor(token))},body:body===undefined?undefined:JSON.stringify(body)}),env);
 return {DB,call};
}
const chat=()=>({id:crypto.randomUUID(),topic:'Leukemia',readingMode:'General reader',historyEpoch:0});
const turn=()=>({id:crypto.randomUUID(),question:'What is leukemia?',text:'Section 1 · A saved research answer.',deck:1,citations:[{title:'Leukemia · MedlinePlus',url:'https://medlineplus.gov/leukemia.html'}],overview:true,historyEpoch:0});
test('workspace trusts verified auth, keeps emails in Supabase, and denies owner/role injection',async t=>{
 const {call,DB}=fixture(t);
 assert.equal((await call('profile','GET',undefined,'invalid')).status,401);assert.equal((await DB.prepare('SELECT count(*) AS n FROM hb_accounts').bind().first()).n,0);
 assert.equal((await (await call('profile')).json()).profile.name,'Researcher A');
 assert.equal((await call('profile','PATCH',{name:'New Researcher'})).status,200);
 assert.equal((await (await call('profile')).json()).profile.name,'New Researcher');
 for(const body of [{name:'Injected',user_id:users.b.id},{name:'Injected',email:'new@example.test'},{name:'Injected',role:'admin'}])assert.equal((await call('profile','PATCH',body)).status,400);
 assert.equal((await (await call('profile','GET',undefined,'b')).json()).profile.name,'');
});
test('new chat, messages, citations, reopen, rename, and single-delete use real SQL',async t=>{
 const {call}=fixture(t),c=chat(),m=turn();
 assert.equal((await call('chats','POST',c)).status,201);
 assert.equal((await call('chats/'+c.id+'/turns','POST',m)).status,201);
 assert.equal((await call('chats/'+c.id+'/turns','POST',m)).status,200);
 const read=await (await call('chats/'+c.id)).json();assert.equal(read.turns.length,1);assert.equal(read.turns[0].citations[0].url,m.citations[0].url);
 assert.equal((await call('chats/'+c.id+'/turns','POST',{...m,text:'Changed payload'})).status,409);
 assert.equal((await call('chats/'+c.id,'PATCH',{title:'Leukemia research'})).status,200);
 assert.equal((await (await call('chats')).json()).items[0].title,'Leukemia research');
 assert.equal((await call('chats/'+c.id,'DELETE')).status,200);assert.equal((await call('chats/'+c.id)).status,404);
});
test('another account cannot read, rename, append, or delete a chat; bulk delete stays owner scoped',async t=>{
 const {call}=fixture(t),a=chat(),b=chat();await call('chats','POST',a);await call('chats','POST',b,'b');await call('chats/'+b.id+'/turns','POST',turn(),'b');
 for(const [path,method,data] of [['chats/'+a.id,'GET'],['chats/'+a.id,'PATCH',{title:'Other'}],['chats/'+a.id,'DELETE'],['chats/'+a.id+'/turns','POST',turn()]])assert.equal((await call(path,method,data,'b')).status,404);
 assert.equal((await (await call('chats','GET',undefined,'b')).json()).items.length,1);
 await call('chats','DELETE',{confirmation:'DELETE_ALL_CHATS'});assert.equal((await call('chats/'+b.id,'GET',undefined,'b')).status,200);
});
test('delete-all clears messages and activity, keeps profile/bookmarks, rejects stale writes',async t=>{
 const {call,DB}=fixture(t),c=chat();await call('settings','PATCH',{saveHistory:true});await call('chats','POST',c);await call('chats/'+c.id+'/turns','POST',turn());
 await call('history','POST',{topic:'Leukemia',kind:'search',section:1});await call('saved','POST',{topic:'Leukemia',kind:'bookmark'});
 assert.equal((await call('chats','DELETE',{confirmation:'wrong'})).status,400);
 const result=await (await call('chats','DELETE',{confirmation:'DELETE_ALL_CHATS'})).json();assert.equal(result.historyEpoch,1);
 for(const table of ['hb_chats','hb_chat_turns','hb_research_history'])assert.equal((await DB.prepare('SELECT count(*) AS n FROM '+table).bind().first()).n,0);
 assert.equal((await (await call('saved')).json()).items.length,1);assert.equal((await call('profile')).status,200);
 assert.equal((await call('chats/'+c.id+'/turns','POST',turn())).status,404);assert.equal((await call('chats','POST',chat())).status,409);
 assert.equal((await call('chats','POST',{...chat(),historyEpoch:1})).status,201);
});
test('saving preference and privacy validation prevent new saved messages',async t=>{
 const {call}=fixture(t),c=chat();await call('chats','POST',c);await call('settings','PATCH',{saveChats:false});
 assert.equal((await call('chats/'+c.id+'/turns','POST',turn())).status,409);
 assert.equal((await call('chats','POST',chat())).status,409);await call('settings','PATCH',{saveChats:true});
 for(const question of ['My name is John and my symptoms are severe.','Contact me at patient@example.com'])assert.equal((await call('chats/'+c.id+'/turns','POST',{...turn(),question})).status,400);
 assert.equal((await call('chats/'+c.id+'/turns','POST',{...turn(),citations:[{title:'Unsafe',url:'javascript:alert(1)'}]})).status,400);
 assert.equal((await call('chats/'+c.id+'/turns','POST',{...turn(),user_id:users.b.id})).status,400);
});
test('saved chat versions preserve old deck meaning and validate the current framework',async t=>{
 const {call}=fixture(t),c=chat();await call('chats','POST',c);
 await call('chats/'+c.id+'/turns','POST',turn());
 const current={...turn(),frameworkVersion:'medical-faq-v3'};
 assert.equal((await call('chats/'+c.id+'/turns','POST',current)).status,201);
 const saved=await (await call('chats/'+c.id)).json();assert.deepEqual(saved.turns.map(t=>t.frameworkVersion),['seven-section-v1','medical-faq-v3']);
 assert.equal((await call('chats/'+c.id+'/turns','POST',{...turn(),frameworkVersion:'made-up'})).status,400);
});

test('legacy settings and saved chats normalize into the three available reading modes',async t=>{
 const {call,DB}=fixture(t);await call('profile');
 for(const [old,expected] of [['Patient','General reader'],['Medical student','Medical professional'],['Advanced professional','Medical professional']]){
  await DB.prepare('UPDATE hb_accounts SET reading_mode=?').bind(old).run();
  assert.equal((await (await call('settings')).json()).settings.readingMode,expected);
  const c={...chat(),readingMode:expected};await call('chats','POST',c);
  await DB.prepare('UPDATE hb_chats SET reading_mode=? WHERE id=?').bind(old,c.id).run();
  assert.equal((await (await call('chats/'+c.id)).json()).chat.readingMode,expected);
  assert.equal((await call('chats','POST',c)).status,200);
 }
});

test('profile details and timezone persist per account; identity and unsafe avatar input are rejected',async t=>{
 const {call}=fixture(t);
 const avatar='data:image/jpeg;base64,/9j/AA==';
 const changed=await call('profile','PATCH',{firstName:'Abhay',lastName:'Srivastav',phone:'+919876543210',avatar});assert.equal(changed.status,200);
 const p=(await (await call('profile')).json()).profile;assert.equal(p.name,'Abhay Srivastav');assert.equal(p.firstName,'Abhay');assert.equal(p.avatar,avatar);assert.equal(p.email,users.a.email);
 const other=(await (await call('profile','GET',undefined,'b')).json()).profile;assert.equal(other.phone,'');assert.equal(other.avatar,'');
 for(const patch of [{avatar:'data:image/svg+xml,<svg/>'},{avatar:'https://tracker.example/photo.jpg'},{phone:'123'},{firstName:'bad\nname'},{email:'attacker@example.test'}])assert.equal((await call('profile','PATCH',patch)).status,400);
 assert.equal((await call('settings','PATCH',{timezone:'Asia/Kolkata'})).status,200);
 assert.equal((await (await call('settings')).json()).settings.timezone,'Asia/Kolkata');
 assert.equal((await call('settings','PATCH',{timezone:'not/a-zone'})).status,400);
 assert.equal((await call('profile','PATCH',{avatar:'',phone:''})).status,200);
 assert.equal((await (await call('profile')).json()).profile.avatar,'');
});
test('research export includes every page of messages and excludes other owners and credentials',async t=>{
 const {call,DB}=fixture(t),a=chat(),b=chat();
 await call('chats','POST',a);await call('chats','POST',b,'b');
 for(let i=0;i<121;i++)await DB.prepare('INSERT INTO hb_chat_turns (id,chat_id,turn_json,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),a.id,JSON.stringify({question:'Question '+i,text:'Saved research answer',citations:[]}),new Date().toISOString()).run();
 await call('chats/'+b.id+'/turns','POST',turn(),'b');
 await call('saved','POST',{topic:'Leukemia',kind:'bookmark'});
 const response=await call('export');assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.match(response.headers.get('Cache-Control'),/no-store/);
 const exported=await response.json();assert.equal(exported.complete,true);assert.equal(exported.messages.length,121);assert.equal(exported.chats.length,1);assert.equal(exported.bookmarks.length,1);assert.equal(exported.profile.email,users.a.email);
 assert.ok(exported.messages.every(m=>m.chatId===a.id));assert.doesNotMatch(JSON.stringify(exported),/access_token|refresh_token|password|b@example.test/);
 assert.equal((await call('export','GET',undefined,'invalid')).status,401);
});

test('Buddy welcome is atomically claimed once per verified login session, across tabs and roles',async t=>{
 const {call}=fixture(t);
 assert.equal((await call('buddy-intro','POST',{},'invalid')).status,401);
 assert.equal((await call('buddy-intro','POST',{user_id:users.b.id})).status,400);
 const simultaneous=await Promise.all([call('buddy-intro','POST',{}),call('buddy-intro','POST',{})]);
 const results=await Promise.all(simultaneous.map(r=>r.json()));assert.equal(results.filter(r=>r.showWelcome).length,1);
 await call('settings','PATCH',{readingMode:'Clinicians'});await call('chats','DELETE',{confirmation:'DELETE_ALL_CHATS'});
 assert.equal((await (await call('buddy-intro','POST',{})).json()).showWelcome,false);
 assert.equal((await (await call('buddy-intro','POST',{},'b')).json()).showWelcome,true);
 assert.equal((await (await call('buddy-intro','POST',{},'refresh')).json()).showWelcome,false);
 assert.equal((await (await call('buddy-intro','POST',{},'a2')).json()).showWelcome,true);
 for(const token of ['missing','mismatch'])assert.equal((await call('buddy-intro','POST',{},token)).status,503);
 assert.equal((await call('buddy-intro','POST',{session_id:sessions.a2})).status,400);
 assert.equal((await call('buddy-intro')).status,405);
});
test('clinical claims, source identifiers and quoted passages survive history and export',async t=>{
 const {savedAnswerFields}=await import('../dist/chat-history.js');
 const {call}=fixture(t),c={...chat(),readingMode:'Clinicians'};
 const ref={id:'PMID: 12345678',title:'Fixture study',url:'https://example.test/study',quote:'Only the measured endpoint was reported.',studyDesign:'Cohort study'};
 const report={clinicalSynthesis:true,blocks:[
  {section:'synthesis',text:'The measured endpoint was reported.',references:[ref]},
  {section:'limitations',text:'A different endpoint was outside the study scope.',references:[{...ref,quote:'Other endpoints were outside the study scope.'}]}
 ]};
 const fields=savedAnswerFields(report),m={...turn(),...fields};
 assert.equal(fields.citations.length,2);
 assert.deepEqual(fields.blocks.map(b=>b.references),[[0],[1]]);
 await call('chats','POST',c);
 const path='chats/'+c.id+'/turns';
 assert.equal((await call(path,'POST',m)).status,201);
 assert.equal((await call(path,'POST',m)).status,200);
 const {turns:[saved]}=await (await call('chats/'+c.id)).json();
 assert.deepEqual(saved.blocks,report.blocks);
 assert.equal(saved.clinicalSynthesis,true);
 assert.match(saved.text,/\[PMID: 12345678\]/);
 const exported=await (await call('export')).json();
 assert.deepEqual(exported.messages[0].blocks,report.blocks);
 assert.equal((await call(path,'POST',{...m,id:crypto.randomUUID(),blocks:[{...fields.blocks[0],references:[9]}]})).status,400);
 assert.equal((await call(path,'POST',{...m,id:crypto.randomUUID(),citations:[{...fields.citations[0],quote:'Email someone@example.test'}]})).status,400);
});

test('six-deck Buddy reports keep the direct answer, cited deck text and empty decks through reload and export',async t=>{
 const {savedAnswerFields}=await import('../dist/chat-history.js');
 const {call}=fixture(t);
 const citation={id:'S1',title:'Reviewed research',url:'https://example.test/excerpt',quote:'The source supports this detail.'};
 const block={text:citation.quote,references:[citation]};
 const report={
  text:'Direct research answer.',
  blocks:[{text:'Direct research answer.',references:[citation]}],
  buddyDecks:Array.from({length:6},(_,i)=>({deck:i+1,title:'Section '+(i+1),blocks:i===3?[]:[block]}))
 };
 const fields=savedAnswerFields(report);
 assert.deepEqual(fields.citations,[citation]);
 const messages=[];
 for(const readingMode of ['General','Clinicians']){
  const c={...chat(),readingMode},message={...turn(),text:report.text,...fields};
  assert.equal((await call('chats','POST',c)).status,201);
  const path='chats/'+c.id+'/turns';
  assert.equal((await call(path,'POST',message)).status,201);
  assert.equal((await call(path,'POST',message)).status,200);
  const {turns:[loaded]}=await (await call('chats/'+c.id)).json();
  assert.deepEqual(loaded.buddyDecks,report.buddyDecks);
  assert.deepEqual(loaded.blocks,report.blocks);
  assert.equal(loaded.text,report.text);
  assert.equal(Boolean(loaded.audienceDisclaimer),readingMode==='General');
  messages.push(loaded.id);
  const invalid=[{buddyDecks:fields.buddyDecks.slice(1)},{buddyDecks:[fields.buddyDecks[1],...fields.buddyDecks.slice(1)]},
   {blocks:[{text:'Unverified claim',references:[2]}]},
   {citations:[{...citation,url:'javascript:bad'}]},
   {buddyDecks:fields.buddyDecks.map(d=>({...d,title:'Patient name: Example'}))}];
  for(const patch of invalid)assert.equal((await call(path,'POST',{...message,id:crypto.randomUUID(),...patch})).status,400);
 }
 const data=await (await call('export')).json();
 for(const id of messages)assert.deepEqual(data.messages.find(m=>m.id===id).buddyDecks,report.buddyDecks);
});
