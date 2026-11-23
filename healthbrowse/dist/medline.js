import {createMedicalRetrieval} from './medical-retrieval.js';
import {topicIndex,resolveSearch} from './discovery.js';
// The publisher gives these three focus areas broader topic titles.
const focusTitles = new Map([
  ['high blood cholesterol','Cholesterol'],
  ['age related macular degeneration','Macular Degeneration'],
  ['diabetic retinopathy','Diabetic Eye Problems']
]);
const norm = name => String(name || '').toLowerCase().normalize('NFKD')
  .replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();

export function medlineIndex(data) {
  let retrieval;
  const related=()=>retrieval??=createMedicalRetrieval(data);
  const names = new Map(), aliases = new Map();
  for (const record of data.topics || []) {
    names.set(norm(record.title),record);
    for (const alias of record.aliases || []) {
      const key=norm(alias);
      const previous=aliases.get(key);
      // Do not invent a unique match for an ambiguous alias.
      aliases.set(key, aliases.has(key) && previous!==record ? null : record);
    }
  }
  for (const [focus,title] of focusTitles) {
    const record=names.get(norm(title));
    if (record) names.set(focus,record);
  }
  const searchIndex=topicIndex((data.topics||[]).map(record=>({name:record.title,aliases:(record.aliases||[]).filter(a=>aliases.get(norm(a))===record)})));
  function namedTopic(query){const choices=resolveSearch(query,searchIndex).choices;if(choices.length!==1)return null;const record=names.get(norm(choices[0]));return record?{topic:record.title,record}:null;}
  return {resolveQuestion:query=>related().resolve(query)||namedTopic(query),find(name){const key=norm(name);if(names.has(key))return names.get(key);if(aliases.has(key))return aliases.get(key);return namedTopic(name)?.record||related().resolve(name)?.record||null;}};
}

export async function loadMedline() {
  const response=await fetch('medline-topics.json');
  if(!response.ok)throw new Error('MedlinePlus topic index unavailable');
  const data=await response.json();
  return {data,index:medlineIndex(data)};
}
