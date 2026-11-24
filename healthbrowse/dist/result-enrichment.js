import {renderEducationalVisual} from './education-visual.js';
import {curatedBrowserVisuals} from './browser-curated-images.js';
import {roleIndex} from './reading-profiles.js';
import {citedHeartFlow,heartIntent,heartFigures} from './heart-visual.js';
import {renderBloodFlow,renderCitedDiagram} from './cited-diagram.js';

const element = (tag, text = '', className = '') =>
  Object.assign(document.createElement(tag), {textContent: text, className});

function httpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

function link(title, url) {
  const a = element('a', title);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const words = value => String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const stop = new Set('what which why does should where who when how with the and for from these that about can have could this they into over are general medical information'.split(' '));
function titleMatch(title, text) {
  const tokens = new Set(words(title));
  return new Set(words(text).filter(w => w.length > 2 && !stop.has(w) && tokens.has(w))).size;
}

const organelleReading = [
  {title:'Mitochondria',publisher:'National Human Genome Research Institute',url:'https://www.genome.gov/genetics-glossary/Mitochondria',takeaway:'The illustrated glossary shows where mitochondria sit in a cell and explains their role in producing ATP.'},
  {title:'Eukaryotic Cells',publisher:'OpenStax · Biology 2e',date:'2018-03-28',url:'https://openstax.org/books/biology-2e/pages/4-3-eukaryotic-cells',takeaway:'Compare mitochondria with the other structures inside an animal cell.'},
  {title:'Mitochondria',publisher:'The Cell · NCBI Bookshelf',date:'2000',url:'https://www.ncbi.nlm.nih.gov/books/NBK9896/',takeaway:'The textbook chapter connects the organelle’s internal structure to its energy-producing machinery.'}
];
const orgTopic = topic => /^mitochondri(?:a|on)$/i.test(topic?.trim());
const controlStandard = 'https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201';

function citedBy(block, sourceList) {
  const resolved = (block.sourceIds || []).map(id => sourceList.find(s => s.id === id));
  return [...(block.references || []), ...(block.citation ? [block.citation] : []), ...resolved].filter(s => s && httpsUrl(s.url));
}

function dateLabel(source, isCitation) {
  const publicationDate = source.publicationDate || source.published || (!isCitation && source.date);
  // Evidence metadata can contain retrieval or snapshot dates. Display only a publisher-supplied publication date.
  return typeof publicationDate === 'string' && /^(?:[12]\d{3}(?:-\d\d(?:-\d\d)?)?|[A-Z][a-z]+ \d{1,2}, [12]\d{3})$/.test(publicationDate)
    ? publicationDate : '';
}

function takeawayFor(s, topic, isCitation) {
  if (s.takeaway) return s.takeaway;
  if (s.passage?.text) return s.passage.text;
  if (s.studyDesign || s.category) {
    return 'Read this ' + String(s.studyDesign || s.category).toLowerCase() + ' for published research on ' + topic + '.';
  }
  const subject = [s.title, s.heading].filter(Boolean).join(' ');
  if (/prevent|vaccin|risk factor/i.test(subject)) return 'Read about prevention and risk factors relevant to ' + topic + '.';
  if (/diagnos|testing|evaluation/i.test(subject)) return 'Review how this source approaches testing and evaluation for ' + topic + '.';
  if (/treat|manage|therap/i.test(subject)) return 'Explore the approaches to managing ' + topic + ' discussed by this publisher.';
  if (/symptom|signs/i.test(subject)) return 'Review the signs and symptoms this source describes for ' + topic + '.';
  if (isCitation) return 'Read the original source behind the explanation of ' + topic + '.';
  return 'Explore the publisher’s discussion of ' + s.title.replace(/[.!?]$/, '') + '.';
}

export function suggestedArticles({topic = '', query = '', answer = {}, articles = [], mode}) {
  const blocks = answer?.blocks || [];
  const cited = [...blocks.flatMap(b => citedBy(b, articles)), ...(answer?.citations || [])];
  const extra = mode === 'medical' && orgTopic(topic) ? organelleReading : [];
  const rows = new Map();
  function add(s, group, isCitation = false) {
    const url = httpsUrl(s?.url);
    if (!url || !s.title || /(?:^|\/)(?:search|searchresults)\b|clinicaltrials\.gov\/search/i.test(new URL(url).pathname) || /[?&](?:term|query|search|q)=/.test(url)) return;
    const key = new URL(url);
    key.hash = '';
    const publisher = s.publisher || s.journal || s.publication || key.hostname.replace(/^www\./,'');
    const date = dateLabel(s, isCitation);
    const score = group + Math.min(6, titleMatch(s.title, topic) + titleMatch(s.title, query)) + (date ? 1 : 0);
    const entry = {title:s.title, url, publisher, date, takeaway:takeawayFor(s, topic, isCitation), score};
    if (!rows.has(key.href) || score > rows.get(key.href).score) rows.set(key.href, entry);
  }
  for (const s of articles) add(s, s.takeaway || s.pmid ? 14 : 5);
  for (const s of extra) add(s, 19);
  for (const s of cited) add(s, 6, true);
  return [...rows.values()].sort((a,b) => b.score-a.score).slice(0,5);
}

function readingList(parent, articles) {
  const section = element('section','','suggested-articles');
  section.append(element('h3','Suggested Articles'));
  if (articles.length) {
    const list=element('ul');
    for (const s of articles) {
      const item=element('li');
      item.append(link(s.title,s.url),element('small',s.publisher+' · '+(s.date || 'Publication date unavailable')),element('p',s.takeaway));
      list.append(item);
    }
    section.append(list);
  } else section.append(element('p','No relevant articles with verified links were available for this answer.','meta'));
  parent.append(section);
}

function processVisual(parent, title, stages, ref) {
  return renderCitedDiagram(parent, title, stages.map(([label, detail]) => ({label, detail, ref})),
    'HealthBrowse diagram adapted from the following source.');
}

function enterpriseVisual(parent,topic,query,articles){
  const reference=id=>articles.find(s=>s.id===id && httpsUrl(s.url));
  const q=topic+' '+query;
  if(reference('as2201')?.url === controlStandard && /\b(?:SOX|Sarbanes.Oxley|internal control over financial reporting|ICFR)\b/i.test(q)){
    processVisual(parent,'How an auditor selects controls to test',[
      ['Financial statements','Identify risks of material misstatement.'],
      ['Accounts and disclosures','Consider entity-level controls and relevant assertions.'],
      ['Control selection','Identify which controls address each assessed risk.']
    ],{title:'PCAOB AS 2201, paragraph 21',url:controlStandard});
  }else if(reference('pdca')&&/pdca|process improvement/i.test(q)){
    processVisual(parent,'One process-improvement cycle',[
      ['Plan','Set the goal and decide how to measure it.'],['Do','Test the proposed change.'],
      ['Check','Compare results with the goal.'],['Act','Adopt or revise the change, then repeat the cycle.']
    ],reference('pdca'));
  }else if(reference('map')&&reference('scope')){
    processVisual(parent,'Mapping an approval workflow',[
      ['Request','Identify the input and its owner.'],['Review','Check the request against the decision criteria.'],
      ['Decision','Route approved requests forward and return incomplete requests for revision.']
    ],reference('map'));
  }else if(reference('plan')&&reference('framework')){
    processVisual(parent,'From data use to a quality check',[
      ['Intended use','Choose the decision that the data must support.'],['Quality rule','Define a measurable condition for a critical field.'],
      ['Follow-up','Assign an owner to investigate results outside the target.']
    ],reference('plan'));
  }else if(reference('logs')&&reference('as1215')){
    processVisual(parent,'Following an audit trail',[
      ['Event','Identify the action and its timestamp.'],['Record','Locate the corresponding log entry and actor.'],
      ['Review','Check coverage and connect the evidence to the conclusion.']
    ],reference('as1215'));
  }else return false;
  return true;
}

// Where a subject-specific illustration is unavailable, diagram the relationship
// between actual answer statements and their citations. Never invent a clinical pathway.
export function supportNodes(answer, articles) {
  const nodes=[];
  const seen=new Set();
  for (const b of answer?.blocks || []) {
    const refs=citedBy(b,articles);
    const text=String(b.text || '').trim();
    if (!refs.length || !text) continue;
    // Keep a whole sentence, including qualifications. If it does not fit, use the source's title.
    const label = text.match(/^.{12,205}?[.!?](?=\s|$)/u)?.[0] || (text.length <= 205 ? text : refs[0].title);
    if (!label || seen.has(label)) continue;
    nodes.push({label,ref:refs[0]});
    seen.add(label);
    if(nodes.length===3) break;
  }
  return nodes;
}

function supportVisual(parent, {answer, articles, topic}) {
  const nodes = supportNodes(answer, articles);
  if (nodes.length) return renderCitedDiagram(parent, topic + ' at a glance', nodes);
  const sources = articles.filter(s => s.title && httpsUrl(s.url)).slice(0, 3);
  return renderCitedDiagram(parent, 'Sources for ' + topic,
    sources.map(ref => ({label: ref.title, ref})), 'HealthBrowse map of sources for this topic.');
}

const lookups = new Map();
function lookupIllustrations(endpoint) {
  const cached = lookups.get(endpoint);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (lookups.size >= 40) lookups.delete(lookups.keys().next().value);
  const entry = {expires: Date.now() + 600000};
  entry.promise = fetch(endpoint, {credentials: 'same-origin', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(33000)})
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const candidates = [data?.visual, ...(Array.isArray(data?.visuals) ? data.visuals : [])].filter(Boolean);
      if (!candidates.length) entry.expires = Date.now() + 30000;
      return candidates;
    })
    .catch(() => { entry.expires = Date.now() + 30000; return []; });
  lookups.set(endpoint, entry);
  return entry.promise;
}

export function visualLookupEndpoint({mode, topic, query, articles = [], illustrationPageId, allowLookup = true}) {
  if (!allowLookup || !topic || topic.length > 120) return '';
  const params = new URLSearchParams({topic});
  if (mode === 'medical') {
    const intent = heartIntent(query);
    if (intent === 'flow') return '';
    if (Object.hasOwn(heartFigures, intent)) {
      params.set('topic', 'Heart');
      params.set('intent', intent);
    }
    return '/api/browser/medical-figure?' + params;
  }
  if (mode !== 'general') return '';
  if (/^the water cycle$/i.test(topic) && articles.some(s => s.id === 'evaporation' && httpsUrl(s.url).startsWith('https://www.usgs.gov/')))
    return '/api/browser/public-figure?id=usgs-water-cycle';
  const wikiArticle = articles.map(s => httpsUrl(s.url)).find(url => /^https:\/\/en\.wikipedia\.org\/\?curid=[1-9]\d{0,9}$/.test(url));
  const pageId = illustrationPageId || (wikiArticle && new URL(wikiArticle).searchParams.get('curid'));
  return '/api/browser/public-figure?' + (/^[1-9]\d{0,9}$/.test(String(pageId)) ? 'id=' + pageId : params);
}

export function enrichResult(visualParent, {readingParent = visualParent, mode, topic = '', query = '',
  answer = {}, articles = [], visual, role, allowLookup = true, signal, illustrationPageId} = {}) {
  const normalizedArticles = Array.isArray(articles) ? articles.filter(Boolean) : [];
  const reading = suggestedArticles({mode, topic, query, answer, articles: normalizedArticles});
  const slot = element('section', '', 'result-visual');
  slot.setAttribute('aria-label', 'Images for ' + topic);
  visualParent.append(slot);
  readingList(readingParent, reading);

  let researchVisual = false;
  const intent = mode === 'medical' ? heartIntent(query) : null;
  if (intent === 'flow' || Object.hasOwn(heartFigures, intent)) {
    const pilot = element('a', 'Try this topic in the cardiology research pilot');
    const params = new URLSearchParams({example: intent, role: roleIndex(role) === 1 ? 'Clinicians' : 'General'});
    pilot.href = '/cardio-pilot.html?' + params;
    const usePolicy = element('button', 'Try the research visual on this answer', 'act');
    usePolicy.type = 'button';
    usePolicy.onclick = async () => {
      usePolicy.disabled = true;
      try {
        const {loadAssets, visualForAnswer, paintVisual} = await import('./cardio-artifacts.js');
        const {corpus, policy} = await loadAssets();
        if (signal?.aborted || !slot.isConnected) return;
        const blocks = (answer.blocks || []).map(b => ({text: b.text, references: citedBy(b, normalizedArticles)}));
        const response = visualForAnswer(query, roleIndex(role) === 1 ? 'Clinicians' : 'General', blocks, corpus, policy);
        const result = element('div');
        if (response.action === 'text') result.append(element('p', 'The research policy selected text only for the cited answer.'));
        else await paintVisual(result, response, corpus);
        if (!signal?.aborted && slot.isConnected) { researchVisual = true; slot.replaceChildren(result); }
      } catch {
        usePolicy.disabled = false;
        usePolicy.textContent = 'Retry research visual';
      }
    };
    readingParent.append(usePolicy, pilot);
  }
  if (intent === 'flow') {
    const refs = (answer.blocks || []).flatMap(b => citedBy(b, normalizedArticles));
    if (renderBloodFlow(slot, citedHeartFlow(refs, roleIndex(role) === 1))) return;
    supportVisual(slot, {topic, answer, articles: normalizedArticles});
    return;
  }
  const fallback = element('div');
  const mapped = mode === 'general' && enterpriseVisual(fallback, topic, query, normalizedArticles);
  if (!mapped) supportVisual(fallback, {topic, answer, articles: [...normalizedArticles, ...reading]});
  const gallery = element('div', '', 'result-images');
  function showImages(candidates) {
    const figures = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate.src) || seen.has(candidate.sourceUrl)) continue;
      const item = element('div');
      const first = figures.length === 0;
      if (!renderEducationalVisual(item, candidate, () => {
        if (!researchVisual && first && !fallback.parentNode) slot.append(fallback);
      })) continue;
      figures.push(item.firstElementChild);
      seen.add(candidate.src);
      seen.add(candidate.sourceUrl);
      if (figures.length === 3) break;
    }
    if (!figures.length) return false;
    gallery.replaceChildren(figures[0]);
    if (figures.length > 1) {
      const more = element('details', '', 'more-result-images');
      const count = figures.length - 1;
      more.append(element('summary', 'Show ' + count + ' more ' + (count === 1 ? 'image' : 'images')), ...figures.slice(1));
      gallery.append(more);
    }
    slot.replaceChildren(gallery);
    return true;
  }
  const curated = mode === 'medical' ? curatedBrowserVisuals(topic) : [];
  const candidates = [...curated, visual];
  const matchesIntent = candidate => !Object.hasOwn(heartFigures, intent) || candidate?.id === heartFigures[intent];
  if (showImages(candidates.filter(matchesIntent))) return;
  slot.append(fallback);
  const endpoint = visualLookupEndpoint({mode, topic, query, articles: normalizedArticles, illustrationPageId, allowLookup});
  if (endpoint && !signal?.aborted) lookupIllustrations(endpoint).then(found => {
    if (!researchVisual && !signal?.aborted && slot.isConnected) showImages(found.filter(matchesIntent));
  });
}
