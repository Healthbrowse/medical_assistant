import {roleIndex} from './reading-profiles.js';

export const pressureTopic = 'High Blood Pressure';
export const pressureQuestion = 'How is high blood pressure managed day to day?';

// Match a request for a general routine. A reading, a symptom, or a question
// about a specific medicine or population must go through its own care route.
export function asksPressureRoutine(question) {
 const words = String(question || '').toLowerCase().replace(/[-–]/g, ' ')
  .replace(/[?.!]+$/, '').trim().replace(/\s+/g, ' ');
 const normalized = words.replace(/\b(?:high blood pressure|hypertension|high bp)\b/g, 'hypertension')
  .replace(/\b(?:day to day|daily|every day|each day|at home|on a daily basis)\b/g, '').replace(/\s+/g,' ').trim();
 return /^(?:how (?:to|can (?:i|we|you|someone)|do (?:i|we|you)|should (?:i|we)) (?:manage|control|lower) (?:my |our )?hypertension|how is hypertension (?:usually |typically )?(?:managed|controlled)|(?:what is |give me |show me )?(?:a |the )?(?:routine|plan|tips) for (?:managing |controlling )?hypertension|(?:managing|manage|controlling) hypertension)$/.test(normalized);
}

const living = {title:'NHLBI · Living with high blood pressure',url:'https://www.nhlbi.nih.gov/health/high-blood-pressure/living-with'};
const treatment = {title:'NHLBI · Treating high blood pressure',url:'https://www.nhlbi.nih.gov/health/high-blood-pressure/treatment'};
const monitoring = {title:'American Heart Association · Home blood pressure monitoring',url:'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home'};
const dash = {title:'NHLBI · DASH eating plan',url:'https://www.nhlbi.nih.gov/health/dash-eating-plan'};

const sections = [
 ['Check and record your blood pressure',
  'Use a validated upper-arm monitor with a cuff that fits. Rest quietly for five minutes, support your arm at heart level, then take two readings a minute apart. Write both down. Ask your clinician when to measure.', monitoring],
 ['Make meals lower in salt',
  'Compare sodium on food labels and choose a lower-sodium option you enjoy. The DASH eating plan emphasizes vegetables, fruit, whole grains and beans. One place to start is replacing a salty side dish at a meal.', dash],
 ['Build movement into your day',
  'Start with an activity you can repeat, such as a short walk. Break up long stretches of sitting. Ask your clinician what level of activity is safe for you, especially when starting a new exercise routine.', treatment],
 ['Make prescribed medicines part of your routine',
  'Take blood pressure medicines as prescribed, even on days you feel well. If side effects or missed doses are a problem, contact your pharmacist or prescriber before making changes.', living],
 ['Protect sleep and manage stress',
  'Keep a regular bedtime and wake-up time. Try a calming activity before bed. If stress makes your routine hard to follow, tell your care team and pick one manageable change to start with.', treatment],
 ['Review your readings and know when to get help',
  'Bring your log and monitor to follow-up and ask what range to aim for. If a nonpregnant adult has a very high reading (top over 180 or bottom over 120 mm Hg) along with chest pain, breathlessness, weakness, vision changes or trouble speaking, call local emergency services immediately. For a reading that high without those symptoms, wait at least a minute and repeat the reading. If it stays that high, contact a healthcare professional immediately.', monitoring]
];
export const pressureSections = sections.map(([title]) => title);
export function pressureDecks() {
 return sections.map(([title,text,source],i) => {
  const ref = {...source,id:'BP'+(i+1),sourceType:'Patient education'};
  return {deck:i+1,title,blocks:[{text,citation:ref,references:[ref],verification:'HealthBrowse summary of the linked patient guidance.'}]};
 });
}
export function pressureRequest(input) {
 if (roleIndex(input.role) || input.attachments) return false;
 if (asksPressureRoutine(input.question)) return true;
 if (input.mode !== 'chat' || !asksPressureRoutine(input.searchQuery) || String(input.topic || '').toLowerCase() !== pressureTopic.toLowerCase()) return false;
 return /^(?:show|give me) (?:all )?(?:six|6) decks[.!?]?$/i.test(input.question.trim()) ||
  (input.deck > 0 && input.question === pressureTopic + ' — ' + pressureSections[input.deck-1]);
}

export function pressureAnswer(decks,number=0) {
 const refs=[living,treatment].map((source,i)=>({...source,id:'Guide'+(i+1)}));
 const blocks=number?decks[number-1].blocks:[{
  text:'Build your routine around reliable home readings, taking prescribed medicines, and changes you can keep up. Start with one habit, such as taking a walk after a meal, and bring your readings to your next appointment.',
  references:refs,verification:'HealthBrowse summary of the linked patient guidance.'
 }];
 return {deck:number,blocks,citations:blocks.flatMap(b=>b.references),text:blocks.map(b=>b.text).join(' '),style:'Plain-language answer',supported:true};
}
