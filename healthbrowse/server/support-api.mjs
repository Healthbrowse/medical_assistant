// Authenticated product support. Messages are data, never model instructions.
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const email=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const reply=(value,status=200)=>Response.json(value,{status,headers});
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
export async function saveSupport(env,user,kind,body,triage){
 const allowed=kind==='feedback'?['message','requestId','category']:['name','email','message','requestId'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))return reply({error:'Unexpected form field.'},400);
 const message=typeof body.message==='string'?body.message.trim():'';
 const name=typeof body.name==='string'?body.name.trim():'';
 const address=typeof body.email==='string'?body.email.trim():'';
 if(!message||message.length>2000)return reply({error:'Enter a message of up to 2,000 characters.'},400);
 if(/\b(?:patient (?:id|name)|date of birth|medical record (?:number|id)|MRN|SSN|my (?:diagnosis|medication|symptoms|address))\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:\d[\s()+.-]*){10,}/i.test(message))return reply({error:'Please remove personal medical details and identifiers from the message.'},400);
 if(kind==='contact'&&(!name||name.length>100||/[\r\n\x00-\x1f]/.test(name)||!email.test(address)||address.length>254))return reply({error:'Check your name and email address.'},400);
 if(body.requestId!==undefined&&!uuid.test(body.requestId))return reply({error:'Invalid submission ID. Reload the form.'},400);
 const categories=['general','source-correction','bug','feature','usability'];
 if(body.category!==undefined&&!categories.includes(body.category))return reply({error:'Choose a feedback category.'},400);
 const classification=triage(message),category=body.category&&body.category!=='general'?body.category:classification.type;
 const payload=JSON.stringify({kind,name,email:address,message,category});
 const hash=await digest(payload),id=body.requestId||crypto.randomUUID(),owner=user.id;
 const sql=(q,...args)=>env.DB.prepare(q).bind(...args);
 let row=await sql('SELECT * FROM hb_support_requests WHERE id=? AND user_id=?',id,owner).first();
 if(row&&row.payload_digest!==hash)return reply({error:'This submission ID belongs to a different message.'},409);
 if(!row){
  const now=new Date().toISOString(),cutoff=new Date(Date.now()-86400000).toISOString();
  const result=await sql(`INSERT OR IGNORE INTO hb_support_requests (id,user_id,kind,name,email,message,category,sentiment,status,payload_digest,created_at)
   SELECT ?,?,?,?,?,?,?,?,'received',?,? WHERE (SELECT count(*) FROM hb_support_requests WHERE user_id=? AND created_at>?)<10`,id,owner,kind,name,address,message,category,classification.sentiment,hash,now,owner,cutoff).run();
  row=await sql('SELECT * FROM hb_support_requests WHERE id=? AND user_id=?',id,owner).first();
  if(!row)return reply({error:result.meta?.changes===0?'Submission limit reached. Please try again tomorrow.':'Your message could not be saved.'},429);
 }
 if(row.payload_digest!==hash)return reply({error:'This submission ID belongs to a different message.'},409);
 if(kind==='feedback')return reply({status:'received',requestId:id,feedback:{id,type:row.category,sentiment:row.sentiment,reviewStatus:'pending'}},201);
 // Database receipt is useful even before a corporate mailbox is configured.
 // Retry the same ID to reconcile a provider timeout without duplicate emails.
 const mailConfigured=env.RESEND_API_KEY&&email.test(env.CONTACT_FROM||'')&&email.test(env.CONTACT_TO||'');
 let delivery=row.status==='sent'?'sent':mailConfigured?'pending':'not_configured';
 if(delivery!=='sent'&&mailConfigured&&Date.now()-Date.parse(row.created_at)<23*3600000){
  delivery='pending';
  try{
   const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'hb-contact/'+owner+'/'+id},body:JSON.stringify({from:env.CONTACT_FROM,to:[env.CONTACT_TO],reply_to:address,subject:'HealthBrowse contact request',text:'Name: '+name+'\nReply email: '+address+'\nReference: '+id+'\n\n'+message})});
   if(res.ok&&typeof (await res.json()).id==='string'){await sql("UPDATE hb_support_requests SET status='sent' WHERE id=? AND user_id=?",id,owner).run();delivery='sent';}
  }catch{/* Receipt remains safely in the support inbox; no message body is logged. */}
 }
 return reply({status:delivery==='sent'?'sent':'received',requestId:id,delivery});
}
