import {resolveSearch} from './discovery.js';
import {correctSpelling} from './medcard.js';
const researchTerms=new Set(['genetics','clinical trials','medical research','research','medicines','drugs','drug therapy','health information','blood','blood tests','treatments','symptoms','genes','chromosomes','drug reactions','laboratory tests','diagnostic tests','fever','pain','side effects']);
export function newSubjects(question,index,currentTopic,medicalIndex){
  const matches=resolveSearch(correctSpelling(question),index).choices;
  const subjects=matches.filter(name=>name.toLowerCase()!==currentTopic.toLowerCase()&&!researchTerms.has(name.toLowerCase()));
  if(subjects.length||!medicalIndex||/\b(it|its|this organ|this gland|this condition|this disease)\b/i.test(question))return subjects;
  const related=medicalIndex.resolveQuestion(correctSpelling(question));
  return related&&related.topic.toLowerCase()!==currentTopic.toLowerCase()&&medicalIndex.find(currentTopic)?.url!==related.record.url?[related.topic]:[];
}
export function inScopeChoices(choices){
  const specific=choices.filter(t=>!researchTerms.has(t.toLowerCase()));
  return specific.length?specific:choices;
}
