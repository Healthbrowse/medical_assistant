// Local research policy. Evidence restricts the eligible actions before scoring.
import {heartIntent, heartFigures, heartParagraphs, heartSourceRank, citedHeartFlow} from './heart-visual.js';

export const actions = ['text', 'clarify', 'illustration', 'diagram'];
export const policyVersion = 'cardio-v1';
export const features = ['bias','broad','chambers','valves','flow','figureAvailable','edgesAvailable',
  'imageSimilarity','visualRequested','textRequested','clinical'];

const preferences = /\b(?:text only|in words only|without (?:a |an |any )?(?:picture|diagram|illustration|visual)|no (?:pictures?|illustrations?|diagrams?|visuals?))\b/gi;
const synonyms = [
  [/\b(?:walk me through|give me an overview of|tell me about|map out|point out|locate)\b/g, 'show'],
  [/\b(?:cross section|cutaway|interior|internal layout|inside|upper and lower rooms)\b/g,'chambers'],
  [/\b(?:one way gates|one way doors|tricuspid|mitral|semilunar|atrioventricular)\b/g,'valves'],
  [/\b(?:journey|travelling|moves|travels|passes|passage|path of circulation|circuit)\b/g,'flow'],
  [/\b(?:pulmonary|systemic|veins|arteries|inflow|outflow)\b/g,'flow'],
  [/\b(?:image|picture|illustration|drawing|sketch|map|visual|arrows|schematic)\b/g,'diagram'],
];
export function interpret(question) {
  let q=String(question).normalize('NFKC').toLowerCase().trim();
  const wantsText=Boolean(q.match(preferences));
  const wantsVisual=/\b(?:image|picture|illustration|draw|drawing|diagram|map|visual|arrows|sketch|schematic)\b/.test(q) && !wantsText;
  q=q.replace(preferences,' ').replace(/[,;:]/g,' ').replace(/[?.!]+$/,'');
  for(const [pattern, word] of synonyms) q=q.replace(pattern,word);
  q=q.replace(/\b(?:with|using) (?:a |an )?diagram\b/g,'diagram').replace(/\s+/g,' ').trim();
  // Yes/no premises require verification outside this normal-anatomy pilot.
  let intent=/^(?:does|do|is|are|can|should|would)\b/.test(q) ? null : heartIntent(q);
  if(!intent && /^(?:show |describe |explain )?(?:the )?(?:normal |adult |human )?(?:heart|cardiac anatomy) (?:overview|basics)$/.test(q)) intent='clarify';
  return {intent, wantsText, wantsVisual};
}
export function planQuestion(question, role, corpus) {
  const {intent,wantsText,wantsVisual}=interpret(question);
  const clinical=role==='Clinicians';
  const refs=(corpus.references||[]).filter(ref=>heartSourceRank(intent,ref)>=0)
    .sort((a,b)=>heartSourceRank(intent,a)-heartSourceRank(intent,b));
  // For a flow request, say only what the referenced edges actually show.
  let edges=intent==='flow'?citedHeartFlow(refs,clinical):[];
  const focus=String(question).toLowerCase();
  const pulmonary=/\bpulmonary\b/.test(focus), systemic=/\bsystemic\b/.test(focus);
  if(pulmonary!==systemic) {
    const labels=pulmonary?['lungs','pulmonary capillaries','pulmonary veins']:['body','systemic veins','systemic arteries'];
    edges=edges.filter(e=>labels.includes(e.from.toLowerCase())||labels.includes(e.to.toLowerCase()));
  }
  // The pinned catalog establishes figure eligibility. Pixel similarity is a ranking signal.
  const approved=intent==='valves'?[heartFigures.valves,heartFigures.chambers]:
    intent==='flow'?[heartFigures.chambers]:[heartFigures[intent]];
  const candidates=approved.flatMap(id=>{
    const figure=id&&corpus.figures.find(f=>f.id===id);
    const score=corpus.index.scores[intent]?.[id];
    return figure&&refs.length&&Number.isFinite(score)?[{figure,score}]:[];
  }).sort((a,b)=>b.score-a.score);
  const selected=candidates[0];
  const eligible=['text'];
  if(!wantsText) {
    if(intent==='clarify') eligible.push('clarify');
    if(selected) eligible.push('illustration');
    if(edges.length) eligible.push('diagram');
  }
  const x=[1,Number(intent==='clarify'),Number(intent==='chambers'),Number(intent==='valves'),
    Number(intent==='flow'),Number(!!selected),Number(edges.length>0),selected?.score||0,
    Number(wantsVisual),Number(wantsText),Number(clinical)];
  return {intent, refs, edges, figure:selected?.figure, eligible, x, clinical};
}
export function pickAction(plan, policy) {
  if(policy.version!==policyVersion || policy.features?.join('|')!==features.join('|'))
    throw Error('Incompatible policy');
  const score=a=>policy.weights[a].reduce((sum,w,i)=>sum+w*plan.x[i],0);
  return plan.eligible.reduce((best,a)=>score(a)>score(best)?a:best);
}
export function prepareCorpus(source, catalog, index) {
  const m=source.modules.find(m=>m.id==='m46676');
  if(!m || source.revision!==catalog.revision || !index.scores) throw Error('Missing cardiology evidence');
  const ids=new Set(Object.values(heartParagraphs).flat());
  const references=m.paragraphs.filter(p=>ids.has(p.id)).map(p=>({title:m.title, url:m.url,
    sourceRevision:source.revision, sourceParagraph:p.id,text:p.text}));
  const figures=catalog.figures.filter(f=>Object.values(heartFigures).includes(f.id) &&
    f.sourceUrl.startsWith(m.url+'#') && f.license==='CC BY 4.0' && index.sha256[f.id])
    .map(f=>({...f,licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}));
  return {references,figures,index};
}
