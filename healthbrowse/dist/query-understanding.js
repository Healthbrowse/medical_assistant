// Clarify ambiguity, never use a fixed disease vocabulary as an eligibility gate.
const abbreviations={
 MS:['Multiple sclerosis','Mitral stenosis','Metabolic syndrome'],
 RA:['Rheumatoid arthritis','Right atrium'],
 PE:['Pulmonary embolism','Pleural effusion','Physical examination'],
 MI:['Myocardial infarction','Mitral insufficiency'],
 ALS:['Amyotrophic lateral sclerosis','Advanced life support']
};
const vague=/^(?:(?:what|how|why|tell|explain|describe|give|show|please|me|about|is|are|do|does|the|a|an|can|you|i|it|this|that|its|more|information|details|treatment|treatments|symptoms?|causes?|diagnosis|tests?|medicine|medication|disease|condition|help|mean|means|work|works|function|functions|and|of|for|to|know|want|need|have|my|problem|something|health|medical)\s*)+$/i;
const followup=/\b(?:it|its|this|that|these|those|more|further|continue|follow.?up)\b/i;
export function clarifyQuery(question,{topic='',context=false}={}){
 const q=String(question||'').trim(),plain=q.replace(/[^a-z\s]/gi,' ').replace(/\s+/g,' ').trim();
 const match=q.match(/\b(MS|RA|PE|MI|ALS)\b/i);
 if(match&&q.split(/\s+/).length<=9&&!Object.values(abbreviations).flat().some(name=>q.toLowerCase().includes(name.toLowerCase()))){
  const names=abbreviations[match[0].toUpperCase()];
  if(!(context&&names.some(name=>topic.toLowerCase().includes(name.toLowerCase()))))return {
   title:'Which meaning do you intend?',text:'“'+match[0]+'” can mean more than one medical term. Choose one, or type the full term.',
   choices:names.map(label=>({label,query:q.replace(match[0],label)})),allowEdit:true
  };
 }
 if(context&&topic&&(followup.test(q)||/^(?:symptoms?|treatment|causes?|diagnosis|tests?)[?!. ]*$/i.test(q)))return null;
 if(!plain||vague.test(plain))return {title:'What would you like to understand?',text:'Add a medical subject so I can find evidence for your question.',choices:[
  {label:'An organ or body function',draft:'What is the function of '},
  {label:'A symptom or condition',draft:'What are the symptoms of '},
  {label:'A medicine or treatment',draft:'How does '}
 ],allowEdit:true};
 return null;
}
const fillers=new Set('i me my we our you your he she they their his her have has had am is are was were a an the what which who how why when where can could should would will please tell explain describe about of to for with and or does do did work works working main primary role function functions normal cause causes caused symptoms symptom treatment treatments treat treated mean means meaning want know need possible possibly it its this that those these more further details information give get understand difference between compare versus vs'.split(' '));
export function usesActiveTopic(question){
 const q=String(question||'');
 return followup.test(q)||/^(?:review )?(?:epidemiology and risk factors|etiology and pathogenesis|clinical manifestations|diagnostic modalities|treatment and management|prognosis and follow-up|symptoms?|treatment|causes?|diagnosis|tests?)[?!. ]*$/i.test(q)||/^(?:who is most affected|what are (?:the )?(?:risk factors|common signs|treatment and management)|what exactly causes|how is this|what is the long-term)/i.test(q);
}
export function retrievalTerms(question,{topic='',context=false}={}){
 const raw=String(question||'').normalize('NFKC').toLowerCase();
 // Send public concepts only, not ages, durations or the original personal narrative.
 const terms=(raw.match(/[a-z][a-z-]*/g)||[]).filter(w=>!fillers.has(w)&&w.length>1&&!/^(?:days?|weeks?|months?|years?|old|ago|today|yesterday)$/.test(w));
 if(context&&topic&&(usesActiveTopic(raw)||!terms.length))terms.unshift(...(topic.toLowerCase().match(/[a-z][a-z-]*/g)||[]).filter(w=>!fillers.has(w)));
 return [...new Set(terms)].slice(0,12).join(' ');
}
export function renderClarification(container,clarification,onChoose,onEdit){
 container.replaceChildren();const panel=document.createElement('section');panel.className='query-clarification';panel.setAttribute('aria-label',clarification.title);
 const heading=document.createElement('h3');heading.textContent=clarification.title;const text=document.createElement('p');text.textContent=clarification.text;panel.append(heading,text);
 const options=document.createElement('div');options.className='clarification-options';
 for(const choice of clarification.choices||[]){const b=document.createElement('button');b.type='button';b.className='act';b.textContent=choice.label;b.onclick=()=>choice.query?onChoose(choice.query):onEdit(choice.draft||'');options.append(b)}
 const edit=document.createElement('button');edit.type='button';edit.className='act';edit.textContent='Write my own question';edit.onclick=()=>onEdit();options.append(edit);panel.append(options);container.append(panel);
}
