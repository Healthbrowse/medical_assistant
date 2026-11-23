// Only subject keywords are sent to external research services.
const omit = new Set('a an and as at are be by can causes clinical describe do does education explain find for from how i in is it me medical of on or tell that the their to what which with please research about show papers evidence articles images videos latest recent studies symptoms treatment treatments diagnosis management prevention guidelines risks screening for'.split(' '));
const words = value => value.toLowerCase().normalize('NFKD').replace(/['’]/g,'').match(/[a-z0-9]+/g) || [];
// Common words are not disease acronyms unless the user capitalizes them.
const ordinaryWords=new Set('all as at in it me men or us can her and on to'.split(' '));
// Build once at startup. Match whole word spans so question wording never becomes an outbound term.
export function topicIndex(entities, vocabulary = []) {
  const index = new Map();
  index.caseSensitiveAliases=new Set();
  for (const label of vocabulary) {
    const term = words(label).join(' ');
    if (term.length >= 3 && !omit.has(term)) index.set(term, label);
  }
  for (const entity of entities) for (const label of [entity.name,...entity.aliases]) {
    const term=words(label).join(' ');index.set(term, entity.name);
    if(/^[A-Z0-9-]{2,6}$/.test(label)&&ordinaryWords.has(term))index.caseSensitiveAliases.add(term);
  }
  // Match everyday symptom descriptions to the symptom topic, not a diagnosis.
  for (const [topic, phrases] of [
    ['sore throat', ['throat hurts','throat is sore','throat feels sore','throat sore','throat pain']],
    ['cough', ['coughing']], ['headache', ['head hurts']], ['dizziness and vertigo', ['feeling dizzy','feels dizzy']]
  ]) {
    const title=index.get(topic);
    if(title) for(const phrase of phrases) if(!index.has(phrase)) index.set(phrase,title);
  }
  return index;
}
export function resolveSearch(input, entitiesOrIndex) {
  const index = entitiesOrIndex instanceof Map ? entitiesOrIndex : topicIndex(entitiesOrIndex);
  const tokens = words(input), choices = new Set();
  const original=String(input).normalize('NFKD').replace(/['’]/g,'').match(/[a-z0-9]+/gi)||[];
  for (let start=0; start<tokens.length; start++) {
    // At each position prefer a specific subtype to its shorter parent label.
    for (let end=tokens.length; end>start; end--) {
      const term=tokens.slice(start,end).join(' '),spelling=original.slice(start,end).join(' ');
      if(index.caseSensitiveAliases?.has(term)&&spelling!==spelling.toUpperCase())continue;
      const topic=index.get(term);
      if (topic) { choices.add(topic); start=end-1; break; }
    }
  }
  return {choices:[...choices], keywords:tokens.filter(w=>!omit.has(w)).join(' ')};
}
const base='https://www.ebi.ac.uk/europepmc/webservices/rest/';
export async function findFigures(subject,signal) {
  const query=new URLSearchParams({query:'TITLE:"'+subject+'" AND OPEN_ACCESS:Y AND SRC:MED',format:'json',pageSize:'5'});
  const response=await fetch(base+'search?'+query,{signal,credentials:'omit'});
  if(!response.ok)throw Error('Figure search unavailable');
  const data=await response.json();
  const candidates=(data.resultList?.result||[]).filter(r=>/^PMC\d+$/.test(r.pmcid)&&!/(retract|withdraw|correction|erratum)/i.test(r.title)).slice(0,3);
  const pages=await Promise.allSettled(candidates.map(async r=>{
    const response=await fetch(base+r.pmcid+'/fullTextXML',{signal,credentials:'omit'});
    if(!response.ok)throw Error('Article unavailable');
    const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
    if(xml.querySelector('parsererror'))throw Error('Invalid article');
    const figure=[...xml.querySelectorAll('fig[id]')].find(f=>f.querySelector('graphic') && f.querySelector('label'));
    if(!figure)return null;
    return {title:figure.querySelector('label').textContent+' · '+r.title,publisher:'PubMed Central',kind:'Published figure',url:'https://pmc.ncbi.nlm.nih.gov/articles/'+r.pmcid+'/figure/'+encodeURIComponent(figure.id||figure.getAttribute('id'))+'/',detail:'Open the original figure and caption. Educational research material.'};
  }));
  if(candidates.length&&pages.every(x=>x.status==='rejected'))throw Error('Figure sources unavailable');
  return pages.flatMap(x=>x.status==='fulfilled'&&x.value?[x.value]:[]);
}
