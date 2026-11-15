// Search the publisher's actual paragraphs, not only its disease-page titles.
// No generated text, inferred diagnoses or remotely supplied evidence enters this index.
const stop=new Set(('a an the and or of to in on at by for from with about as is are was were be been being do does did can could would should will may might what which who why how where when i me my you your we our it its they their this that these those please tell explain describe know information medical health main primary major basic normal function functions role roles purpose work works working located location produce produces production happen happens').split(' '));
const generic=new Set(['body','organ','organs','gland','glands','cell','cells','system','disease','diseases','condition','conditions','symptom','symptoms']);
const words=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/['’]/g,'').match(/[a-z0-9]+/g)||[];
const stem=word=>word.length>4?word.replace(/ies$/,'y').replace(/s$/,''):word;
export const functionQuestion=query=>/\b(?:functions?|purpose|roles?|what (?:does|do) .+ do|how (?:does|do) .+ work|where (?:is|are) .+ (?:located|found))\b/i.test(query);
export function medicalSubject(query){
 const terms=words(query).filter(w=>!stop.has(w));
 if(!terms.length||terms.length>10||!terms.some(t=>t.length>=4&&!generic.has(t))||terms.some(t=>/^\d/.test(t)))return null;
 return terms.join(' ');
}
export function createMedicalRetrieval(feed){
 const rows=(feed.topics||[]).filter(record=>/^https:\/\/medlineplus\.gov\/[a-z0-9-]+\.html$/.test(record.url||'')).map(record=>({record,
  title:new Set(words(record.title).map(stem)),
  passages:(record.knowledge||Object.values(record.sections||{}).map(text=>({text}))).map(p=>({text:p.text||'',overview:!!p.overview,terms:new Set(words(p.text).map(stem))}))}));
 function search(query){
  const subject=medicalSubject(query);if(!subject)return [];
  const terms=[...new Set(words(subject).map(stem))];
  return rows.flatMap(({record,title,passages})=>{
   // Every retained subject term must occur together in one retrieved paragraph.
   const matching=passages.filter(p=>terms.every(t=>p.terms.has(t)));
   if(!matching.length)return [];
   const titleHits=terms.filter(t=>title.has(t)).length;
   const normalLead=matching.some(p=>/^(?:your |the |you have )/i.test(p.text)&&terms.every(t=>new Set(words(p.text.slice(0,160)).map(stem)).has(t))&&/\b(?:hormones?|functions?|filter|pump|carry|carries|digest|controls?|regulates?|produce|produces|protect)\b/i.test(p.text));
   const broadTitle=/\b(?:diseases|disorders)\b/i.test(record.title)?3:0;
   const score=titleHits*12+Number(matching.some(p=>p.overview))*4+Number(normalLead)*15+broadTitle;
   return [{record,score,subject,passages:matching}];
  }).sort((a,b)=>b.score-a.score||a.record.title.length-b.record.title.length||a.record.title.localeCompare(b.record.title));
 }
 return {search,resolve(query){const hits=search(query);if(!hits.length)return null;
  // This selects a supporting publisher page, not a disease or diagnosis.
  // Keep the user's subject as the workspace title even if the page is about a disorder.
  const hit=hits[0];return {topic:hit.subject[0].toUpperCase()+hit.subject.slice(1),record:hit.record};
 }};
}
