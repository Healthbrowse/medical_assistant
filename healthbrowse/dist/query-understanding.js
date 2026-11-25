import {heartIntent} from './heart-visual.js';

// Clarify ambiguity, never use a fixed disease vocabulary as an eligibility gate.
const abbreviations={
 MS:['Multiple sclerosis','Mitral stenosis','Metabolic syndrome'],
 RA:['Rheumatoid arthritis','Right atrium'],
 PE:['Pulmonary embolism','Pleural effusion','Physical examination'],
 MI:['Myocardial infarction','Mitral insufficiency'],
 ALS:['Amyotrophic lateral sclerosis','Advanced life support']
};
const vague=/^(?:(?:what|how|why|tell|explain|describe|give|show|please|me|about|is|are|do|does|the|a|an|can|you|i|it|this|that|its|more|information|details|treatment|treatments|symptoms?|causes?|diagnosis|tests?|medicine|medication|disease|condition|help|mean|means|work|works|function|functions|and|of|for|to|know|want|need|have|my|problem|something|health|medical)\s*)+$/i;
const followup=/\b(?:it|its|this|that|these|those)\b|^(?:tell me more|go further|continue|follow[- ]?up|more)[?!. ]*$/i;
export function clarifyQuery(question,{topic='',context=false,browser=false}={}){
 const q=String(question||'').trim(),plain=q.replace(/[^a-z\s]/gi,' ').replace(/\s+/g,' ').trim();
 if(/\[(?:medication|medicine|drug)(?: name)?\]|\b(?:side effects?|precautions?)\b.*\b(?:this|my|a) (?:medicine|medication|drug)[?!. ]*$/i.test(q))return {
  title:'Which medicine are you asking about?',text:'Enter the medicine name as printed on the label so the sources match it.',choices:[],allowEdit:true
 };
 if(browser&&heartIntent(q)==='clarify')return {
  title:'What would you like to know about the heart?',text:'Choose a topic or write your own question.',choices:[
   {label:'Heart anatomy',query:'What are the chambers of the human heart?'},
   {label:'How the heart pumps blood',query:'How does the heart pump blood?'},
   {label:'Common heart conditions',query:'What are common heart conditions?'}
  ],allowEdit:true
 };
 const match=q.match(/\b(MS|RA|PE|MI|ALS)\b/i);
 if(match&&q.split(/\s+/).length<=9&&!Object.values(abbreviations).flat().some(name=>q.toLowerCase().includes(name.toLowerCase()))){
  const names=abbreviations[match[0].toUpperCase()];
  if(!(context&&names.some(name=>topic.toLowerCase().includes(name.toLowerCase()))))return {
   title:'Which meaning do you intend?',text:'“'+match[0]+'” can mean more than one medical term. Choose one, or type the full term.',
   choices:names.map(label=>({label,query:q.replace(match[0],label)})),allowEdit:true
  };
 }
 if(context&&topic&&usesActiveTopic(q))return null;
 if(!plain||vague.test(plain))return {title:'What would you like to understand?',text:'Add a medical subject so I can find evidence for your question.',choices:[
  {label:'An organ or body function',draft:'What is the function of '},
  {label:'A symptom or condition',draft:'What are the symptoms of '},
  {label:'A medicine or treatment',draft:'How does '}
 ],allowEdit:true};
 return null;
}
const fillers=new Set('i me my we our you your he she they their his her have has had am is are was were a an the what which who how why when where can could should would will please tell explain describe about of to for with and or does do did work works working main primary role function functions normal cause causes caused symptoms symptom treatment treatments treat treated mean means meaning want know need possible possibly it its this that those these more further details information give get understand difference between compare versus vs'.split(' '));
// Retain the active study for questions that name a comparator or endpoint
// without repeating the study topic. Named questions can select a new topic.
export function studyFollowUp(question){
 const q=String(question||'').trim().replace(/[?!.]+$/,'').trim();
 if(q.length>180||!/^(?:what|which|who|how|did|were|was|is|are|explain|describe|summari[sz]e|compare)\b/i.test(q))return false;
 const field=q.match(/\b(?:the|this|that|these|those|their|its) (?:study|studies|trial|population|intervention|comparator|control arm|confidence intervals?|primary endpoints?|endpoints?|outcomes?|results?|effect sizes?|evidence base|contraindications?)\b(.*)$/i);
 if(!field)return false;
 const suffix=field[1].trim();
 return !suffix||/^(?:design|measure|show|report|use|find|include|apply|support|account|compar|population|select|assess|exclude|recruit)\w*\b/i.test(suffix);
}
// These question fragments name a medical section but omit its subject. An
// explicit disease or drug name must remain eligible for a new topic lookup.
const sectionTerms = new Set(('sign signs symptom symptoms risk risks factors cause causes etiology pathogenesis mechanism mechanisms physiology epidemiology manifestations demographics diagnosis diagnostic criteria modalities tests testing investigations management treatment treatments therapies medications medicines prevention prognosis outlook course progression outcomes follow-up complications contraindications effects function functions incidence prevalence mortality assessment options').split(' '));
const sectionModifiers = new Set(('please can could you tell me show give list explain review describe what which who are is how does do the a an of for be have been being most more or and commonly common typical main early late clinical first major usual possible potential standard recommended available long-term long term exactly people population groups patients affected at used present look like best key warning side signs').split(' '));

export function isMedicalSectionFollowUp(question) {
 const words=String(question||'').toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g)||[];
 return words.length>0 && (words.some(word=>sectionTerms.has(word))||words.includes('affected'))
  && words.every(word=>sectionTerms.has(word)||sectionModifiers.has(word));
}

export function usesActiveTopic(question){
 const q=String(question||'');
 return studyFollowUp(q)||followup.test(q)||isMedicalSectionFollowUp(q);
}
function searchWords(text){
 // Keep numbers that identify a biomedical concept. Standalone measurements,
 // ages, durations and numeric identifiers do not belong in a public search.
 const tokens=text.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*|[0-9]+/g)||[];
 return tokens.filter((word,i)=>{
  if(/^\d+$/.test(word))return /^[1-4]$/.test(word)&&['type','stage','grade','phase','class'].includes(tokens[i-1]);
  return word.length>1&&!/\d{4,}/.test(word)&&!fillers.has(word)&&!/^(?:days?|weeks?|months?|years?|old|ago|today|yesterday)$/.test(word);
 });
}
export function retrievalTerms(question,{topic='',context=false}={}){
 const raw=String(question||'').normalize('NFKC').replace(/\ball\b/g,' ').toLowerCase()
  .replace(/\b(?:my\s+)?(?:doctor|physician|clinician)\s+(?:said|says|told me|mentioned|diagnosed(?: me with)?)\b/g,' ')
  .replace(/\b(?:really|very|pretty|quite|still|just|so|bad|badly)\b/g,' ')
  .replace(/\b(?:hurting|hurts|hurt)\b/g,'pain');
 // Send public concepts only, not ages, durations or the original personal narrative.
 const terms=searchWords(raw);
 if(context&&topic&&(usesActiveTopic(raw)||!terms.length))terms.unshift(...searchWords(topic.toLowerCase()));
 return [...new Set(terms)].slice(0,12).join(' ');
}
export function renderClarification(container,clarification,onChoose,onEdit){
 container.replaceChildren();const panel=document.createElement('section');panel.className='query-clarification';panel.setAttribute('aria-label',clarification.title);
 const heading=document.createElement('h3');heading.textContent=clarification.title;const text=document.createElement('p');text.textContent=clarification.text;panel.append(heading,text);
 const options=document.createElement('div');options.className='clarification-options';
 for(const choice of clarification.choices||[]){const b=document.createElement('button');b.type='button';b.className='act';b.textContent=choice.label;b.onclick=()=>choice.query?onChoose(choice.query):onEdit(choice.draft||'');options.append(b)}
 const edit=document.createElement('button');edit.type='button';edit.className='act';edit.textContent='Write my own question';edit.onclick=()=>onEdit();options.append(edit);panel.append(options);container.append(panel);
}

// Keep a knowledge subject itself; a disease-page alias is only a possible source.
export function educationalSubject(question){
 if(!/^(?:what (?:is|are)|what does .+ do(?=[?!.]*$)|what (?:is|are) (?:the )?(?:main )?functions?|how does .+ work(?=[?!.]*$)|explain|describe|tell me about)\b/i.test(String(question).trim()))return '';
 return retrievalTerms(question);
}
