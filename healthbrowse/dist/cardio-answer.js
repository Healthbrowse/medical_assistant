import {planQuestion,pickAction} from './cardio-planner.js';
import {citedHeartFlow,heartSourceRank} from './heart-visual.js';

export const examples={
  clarify:'Heart',
  chambers:'What are the chambers of the human heart?',
  valves:'Where are the valves of the heart?',
  flow:'How does the heart pump blood?'
};
// Build every visual from the same evidence used for the displayed answer.
export function composeResponse(question,plan,action){
  if(!plan.eligible.includes(action)) throw Error('Action lacks evidence or conflicts with the question');
  if(action==='clarify')return {action,blocks:[],choices:[examples.chambers,examples.valves,examples.flow]};
  if(!plan.refs.length) return {action:'text',blocks:[],message:plan.intent==='clarify'?
    'This pilot covers the chambers, valves and circulation of the normal adult heart.':
    'This pilot has insufficient evidence for this question. Its sources cover normal adult heart anatomy and circulation.'};
  const blocks=[];
  if(plan.intent==='flow'){
    for(const row of plan.edges){
      blocks.push({text:'Blood flows from '+row.from.toLowerCase()+' to '+row.to.toLowerCase()+'.',ref:row.ref});
    }
  }else{
    const namedValve=/\b(mitral|tricuspid|semilunar)\b/i.exec(question)?.[1].toLowerCase();
    const relevant=plan.refs.filter(r=>heartSourceRank(plan.intent,r)>=0 && (!namedValve||r.text.toLowerCase().includes(namedValve)));
    for(const ref of relevant.slice(0,plan.clinical?4:2)){
      const sentences=ref.text.match(/[^.!?]+(?:[.!?]+|$)/g)||[];
      const selection=namedValve?sentences.filter(s=>s.toLowerCase().includes(namedValve)):sentences;
      const text=selection.slice(0,plan.clinical?3:2).join('').trim().replace(/\s*\(\s*\)/g,'');
      if(text)blocks.push({text,ref});
    }
  }
  if(!blocks.length)return {action:'text',blocks:[],message:'The retrieved passages do not support a response to this question.'};
  return {action,blocks,figure:action==='illustration'?plan.figure:null,edges:action==='diagram'?plan.edges:[]};
}

// Use only passages cited by the final answer. Match each fragment to the pinned
// text, then require a supported assertion in the same block as its citation.
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function visualForAnswer(question,role,blocks,corpus,policy){
  const contexts=[];
  for(const b of blocks){
    for(const r of b.references||[]){
      const full=corpus.references.find(s=>s.sourceParagraph===r.sourceParagraph && s.sourceRevision===r.sourceRevision && s.url===r.url);
      if(full && normalize(r.text).length>=32 && normalize(full.text).includes(normalize(r.text)))contexts.push({ref:r,claim:b.text||''});
    }
  }
  const plan=planQuestion(question,role,{...corpus,references:contexts.map(c=>c.ref)});
  const act=pickAction(plan,policy);
  if(act==='diagram'){
    const edges=plan.edges.filter(e=>contexts.some(c=>{
      if(c.ref.sourceParagraph!==e.ref.sourceParagraph)return false;
      const claim=normalize(c.claim);
      const sentence='blood flows from '+e.from.toLowerCase()+' to '+e.to.toLowerCase();
      const direct=claim.split(/[.!?]/).some(s=>s.trim()===sentence);
      const extracted=citedHeartFlow([{...c.ref,text:c.claim}],plan.clinical).some(row=>row.from===e.from && row.to===e.to);
      return direct || (extracted && normalize(c.ref.text).includes(claim.replace(/[.!?]$/,'')));
    }));
    if(edges.length)return {action:act,edges};
  }
  if(act==='illustration' && contexts.some(c=>heartSourceRank(plan.intent,c.ref)>=0 &&
      (plan.intent==='valves'?/\b(?:valves?|mitral|tricuspid)\b/i:/\b(?:chambers?|atrium|atria|ventricles?)\b/i).test(c.claim)))
    return {action:act,figure:plan.figure};
  return {action:'text'};
}
