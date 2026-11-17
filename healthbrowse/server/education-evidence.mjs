import {readingProfile} from '../dist/reading-profiles.js';
import {domains} from '../dist/disease-framework.js';
import {faqQuestions} from '../dist/faq-spec.js';
import {retrievalTerms} from '../dist/query-understanding.js';
import {sourcePassages} from './live-evidence.mjs';
const cache=new WeakMap();
const revision='b0058a743bdd2cc08196abaaa7d5469970c0d80c';
const tokens=text=>String(text||'').toLowerCase().match(/[a-z][a-z-]*/g)||[];
const stem=w=>w.length>4?w.replace(/ies$/,'y').replace(/s$/,''):w;
export function educationEvidence(assets,input){
 if(!assets['/education-sources.json'])return [];
 let index=cache.get(assets);
 if(!index){
  const data=JSON.parse(assets['/education-sources.json'].text);
  if(data.revision!==revision||data.license!=='CC BY 4.0')return [];
  const rows=data.modules.filter(m=>m.url==='https://github.com/openstax/osbooks-anatomy-physiology/blob/'+revision+'/modules/'+m.id+'/index.cnxml')
   .flatMap(m=>m.paragraphs.map(p=>({module:m,paragraph:p,terms:new Set(tokens(m.title+' '+p.heading+' '+p.text).map(stem))})));
  index={data,rows};cache.set(assets,index);
 }
 const query=retrievalTerms(input.question,{topic:input.topic,context:input.mode==='chat'}),wanted=tokens(query).map(stem);
 if(!wanted.length)return [];
 const matches=index.rows.map(row=>{
  const count=wanted.filter(t=>row.terms.has(t)).length;
  if(count<Math.ceil(wanted.length*.75))return null;
  const text=row.paragraph.text.toLowerCase(),heading=(row.module.title+' '+row.paragraph.heading).toLowerCase();
  const phrase=wanted.map(w=>w+'s?').join('\\s+');
  const lead=new RegExp('^(?:(?:a|an|the|your) )?'+phrase+'\\b','i').test(text);
  const definition=new RegExp('\\b'+phrase+' (?:is|are|refers|consists|secretes|produces|controls|regulates)\\b','i').test(text.slice(0,350));
  const textTerms=new Set(tokens(text).map(stem));
  const score=Number(lead)*18+Number(definition)*24+wanted.filter(w=>textTerms.has(w)).length*5+count*3+wanted.filter(t=>tokens(heading).map(stem).includes(t)).length*5+(text.includes(query)?12:0);
  return {...row,score};
 }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,10);
 return matches.flatMap(({module:m,paragraph:p})=>sourcePassages(p.text,{title:m.title+' · '+(p.heading?p.heading+' · ':'')+'OpenStax Anatomy and Physiology 2e',heading:p.heading,url:m.url,
  date:'Source snapshot 11 March 2026; collected '+index.data.collectedAt,sourceType:'foundational medical education · textbook, not a clinical guideline',license:index.data.license,licenseUrl:index.data.licenseUrl,attribution:index.data.attribution,sourceParagraph:p.id,sourceRevision:revision}));
}
export function addEducation(evidence,sources,input={}){
 if(!sources.length)return evidence;
 const seen=new Set(),rows=[];
 for(const s of [...sources,...(evidence?.sources||[])]){const key=s.url+'|'+s.text+'|'+s.deck+'|'+s.overview;if(seen.has(key))continue;seen.add(key);rows.push({...s,id:'S'+(rows.length+1)})}
 return {...(evidence||{topic:input.topic,role:input.role,style:readingProfile(input.role).style,domains:domains.slice(0,6).map((d,i)=>({id:i+1,title:d.title,question:faqQuestions[i],scope:d.scope}))}),sources:rows};
}
