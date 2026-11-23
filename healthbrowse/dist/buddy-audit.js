// Keep the handoff in the current tab. Client citations can be inspected locally;
// they are never promoted to evidence by the remote medical answer endpoint.
const normalize=text=>String(text||'').replace(/\s+/g,' ').trim().toLowerCase();
function safeSource(source) {
 try {
  const url=new URL(source.url);
  if(url.protocol!=='https:'||url.username||url.password)return null;
  return {id:source.id,title:source.title||source.publisher||url.hostname,url:url.href,
   quote:source.quote||source.text||'',date:source.date||'',sourceType:source.sourceType||source.publisher||''};
 }catch{return null}
}
export function auditBrowserAnswer(context,question=''){
 const sources=(context.browserSources||[]).map(safeSource).filter(Boolean);
 const byId=new Map(sources.filter(s=>s.id).map(s=>[s.id,s]));
 const answer=context.directAnswer||{};
 const items=answer.blocks?.length?answer.blocks:(answer.text||context.answerSummary||'').split(/\n\s*\n/).filter(Boolean).map(text=>({text}));
 const methodology=/\b(methods?|methodology|sample|dataset|population|validation|quality|limitations?)\b/i.test(question);
 const blocks=[];
 for(const item of items){
  const cited=(item.references||[item.citation].filter(Boolean)).map(safeSource).filter(Boolean);
  const refs=cited.length?cited:(item.sourceIds||[]).map(id=>byId.get(id)).filter(Boolean);
  for(const line of String(item.text||'').split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean)){
   const claim=normalize(line.replace(/\[(?:[A-Z]*\d+)\]/g,''));
   const exact=refs.some(r=>claim.length>=12&&normalize(r.quote).includes(claim));
   blocks.push({title:exact?'Matches cited passage':refs.length?'Compare with cited source':'Citation unavailable for this claim',text:line,references:refs,
    verification:exact?'The wording appears in the supplied passage.':refs.length?'Open the source and compare scope, wording and qualifications.':'The browser supplied no claim-specific citation.'});
  }
 }
 if(methodology){
  const refs=[...new Map([...sources,...blocks.flatMap(b=>b.references)].map(r=>[r.url,r])).values()];
  const matches=refs.filter(r=>/\b(methods?|cohort|participants?|sample|dataset|randomi[sz]|validation|limitations?)\b/i.test(r.quote));
  return {text:matches.length?'Methods and limitations in the supplied passages.':'The available passages do not describe the methods or validation. Open the full sources or attach the methods section in Buddy.',blocks:matches.map(r=>({title:r.title,text:r.quote,references:[r]})),citations:refs};
 }
 return {text:blocks.length?'Claim and source comparison.':'The browser has not supplied an answer to check yet.',blocks,citations:sources,
  gaps:blocks.length?['These checks compare wording and citations. Interpretation requires reading the linked sources in context.']:[]};
}

export async function generalBuddyAnswer(question,topic,signal){
 const res=await fetch('/api/browser/general',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,topic:topic||undefined}),signal,cache:'no-store',redirect:'error'});
 const data=await res.json();
 if(!res.ok||data.status==='blocked')return {text:data.answer||data.message||'This request could not be processed.',blocks:[],citations:[]};
 const refs=(data.articles||[]).map(safeSource).filter(Boolean),byId=new Map(refs.map(r=>[r.id,r]));
 return {topic:data.topic, text:data.answer||'No relevant source was found.',blocks:(data.blocks||[]).map(b=>({text:b.text,references:(b.sourceIds||[]).map(id=>byId.get(id)).filter(Boolean)})),citations:refs};
}
