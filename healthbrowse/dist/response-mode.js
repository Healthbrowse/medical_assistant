import {studyFollowUp} from './query-understanding.js';
import {inspectQuery} from './clinical-engine.js';
import {resolveSearch} from './discovery.js';
import {assessSafety, safetyAnswer} from './safety-policy.js';
import {assessBuddySafety, buddySafetyAnswer, securityVariants} from './buddy-policy.js';

// Response domain and reading audience are independent. A clinician may ask
// about a financial control and a general reader may ask about a drug.
const enterpriseTask = /\b(?:SOX|Sarbanes[ -]Oxley|PCAOB|ICFR|COSO|SEC filings?|audit trails?|financial report(?:s|ing)|internal controls?|segregation of duties|board governance|change management|procurement|payroll|invoic(?:e|es|ing)|accounts? (?:receivable|payable)|materiality|budget(?:ing)?|stock market|balance sheets?|quarterly earnings|vendor (?:risk|assessment)|revenue cycle|billing workflow|scheduling workflow|administrative workflow|process mapping)\b/i;
const nonmedicalSense = /\b(?:great depression|technical debt|bank stress tests?|load test(?:ing)?|network congestion|computer virus(?:es)?|malware|viral marketing|battery cells?|spreadsheet cells?|Excel|Google Sheets|cell phones?|(?:mechanical|tensile|compressive|shear) stress|stress (?:applied to|on) (?:a |the )?(?:beam|truss|structure)|drawing (?:a |the )?stroke|stroke (?:width|attribute)|SVG|stem education|computer memory|memory leak|Python environment|Java programming|human resources|MS (?:Excel|Word|Office|Teams)|source control|version control|blood oranges?|heart of (?:a|the) (?:city|matter)|immune (?:to )?market|health (?:checks?|endpoint|of (?:the )?(?:network|economy|server)))\b/i;
// Some terms name both an organism and a computing concept.
const computingVirus = /\bvirus(?:es)?\b/i;
const computingContext = /\b(?:computer|laptop|internet|network drive|USB|file system|antivirus)\b/i;
const clinical = /\b(?:health(?:care)?|medical|medicin(?:e|al)|clinical|patient(?:s)?|disease(?:s)?|disorders?|diagnos\w+|symptoms?|side effects?|contraindications?|pharmaco\w+|therapeutic\w*|medications?|drug (?:interactions?|dose|dosing|therapy)|dosing|dosage|vaccin\w*|antibiotics?|syndromes?|infections?|surg(?:ery|ical)|physiolog\w*|anatom\w+|patholog\w*|epidemiolog\w*|immun\w+|fevers?|abdomen|abdominal|cough(?:s|ing)?|headaches?|dizz(?:y|iness)|nausea|vomit\w*|sore throat|stomach|blood|bilirubin|insulin|glucose|cancer|diabet\w*|leuk[ae]*mia|hypertension|pituitary|glands?|hypothalam\w*|hormones?|enzymes?|platelets?|hemoglobin|haemoglobin|pregnan\w+|seizures?|heart attack|chest pain|lungs?|kidneys?|liver|cardiac|endocrin\w*|renal|pulmonary|respiratory|skeletal|digestive|pancrea\w*|ear(?:s)?|retina|cochlea|femur|vertebrae?|spinal cord|blood vessels?|tumou?rs?|neurons?|neurotransmitters?|asthma|influenza|dengue|paracetamol|ibuprofen|aspirin|metformin|acetaminophen|MRI|ECG|HbA1c|TSH|EEG)\b/i;
const lifeScience = /\b(?:life sciences?|biology|biological|biochem\w*|biomed\w*|biotech\w*|genetic\w*|genom\w+|genes?|DNA|RNA|ribosom\w*|mitochondri\w*|chloroplasts?|organelles?|chromosom\w+|photosynth\w*|glycolysis|Krebs cycle|cell(?:s|ular)?|cell membranes?|stem cells?|mitosis|meiosis|protein(?:s)?|amino acids?|antibod\w+|bacteri\w+|viruses|virus|pathogens?|microb\w+|microorganisms?|eukaryot\w*|prokaryot\w*|organisms?|exocytosis|endocytosis|osmosis|diffusion across|homeosta\w*|keratin|polymerase|PCR|transcriptom\w*|peptides?|polypeptides?|peptid\w+|lipids?|chlorophyll|biodiversity|ecolog\w*|evolutionary|botany|botanical|zoolog\w*|ATP|plant growth|plants? (?:grow|reproduce)|plants? (?:make|produce) (?:sugars?|food))\b/i;
const personalSymptom = /\b(?:(?:my|his|her|their)\s+(?:arm|leg|back|head|knee|neck|ear|throat|chest|foot|stomach)\s+(?:hurts?|aches?|is sore|is swollen)|pain in (?:my|his|her|the)|i (?:feel sick|feel unwell|am bleeding|hurt my))\b/i;
const medicalAbbreviation = /\b(?:ICD[- ]?(?:9|10|11)|SNOMED|LOINC|RxNorm)\b|^(?:(?:what is|what does|explain|define)\s+)?(?:RA|MS|PE|MI|ALS)(?: mean| stand for)?[?!. ]*$/i;
// Drug families and study language can identify a new therapy before the topic
// catalogue includes it. This classifies the question; it does not validate a drug.
const clinicalResearch = /\b(?:HFpEF|HFmrEF|HFrEF|CVID|COPD|CKD|SGLT[- ]?2i?|GLP[- ]?1(?:RA)?|DPP[- ]?4|eGFR|NSAIDs?|placebo[- ]controlled|phase (?:[1-4]|i{1,3}|iv)[ab]? (?:clinical )?trials?|randomi[sz]ed controlled trials?|adverse events?|overall survival|progression[- ]free survival|intention[- ]to[- ]treat|first[- ]in[- ]human)\b/i;
const drugName = /\b[a-z]{3,}(?:mab|tinib|gliflozin|gliptin|glutide|sartan|vastatin)\b/i;
const topicFollowup = /^(?:(?:please )?(?:tell me more|go (?:deeper|on)|continue|give (?:an?|me an?) example|(?:check|verify|audit|explain|summari[sz]e) (?:this|that|it|(?:the|these|those) (?:sources?|claims?|answer|findings?))|how does (?:it|this|that) work|what (?:are|is) (?:the |its |their )?(?:risks?|benefits?|limitations?|next steps?|evidence)|what (?:should|can) (?:i|we) do(?: next)?|what (?:about|does) (?:it|this|that)(?: mean)?|why|how|more)(?: in (?:more )?detail)?)[?!. ]*$/i;

export function classifyResponseMode(question, {index, topic, previousMode} = {}) {
  const query = String(question ?? '').normalize('NFKC').trim();
  if (enterpriseTask.test(query) || nonmedicalSense.test(query) || (computingVirus.test(query) && computingContext.test(query))) return 'general';
  if (clinical.test(query) || lifeScience.test(query) || personalSymptom.test(query) || medicalAbbreviation.test(query) ||
      clinicalResearch.test(query) || drugName.test(query)) return 'medical';
  // Only short, topic-free follow-ups inherit the current card. "Explain this
  // database" in a medical thread is a new general research question.
  if (topic && (topicFollowup.test(query) || studyFollowUp(query)) && ['medical','general'].includes(previousMode)) return previousMode;
  if (index instanceof Map && query.length <= 1200 && resolveSearch(query, index).choices.length) return 'medical';
  return 'general';
}

export function screenGeneralQuery(question, context = '') {
  const original = String(question ?? '').trim();
  const status = inspectQuery(original);
  if (status === 'emergency') {
    return {status, safety:{text:'If these symptoms or immediate danger are happening now, contact local emergency services now. Do not wait for a search response.', citations:[]}};
  }
  if (status === 'private') {
    return {status, safety:{text:'Remove identifying details, account numbers and credentials before searching.', citations:[]}};
  }
  const clinicalRisk = securityVariants(original).map(value => assessSafety(value, context)).find(result => result.action !== 'allow');
  if (clinicalRisk) return {status:'unsafe', safety:safetyAnswer(clinicalRisk.category)};
  if (status === 'unsafe') {
    const {category} = assessBuddySafety(original);
    const answer = buddySafetyAnswer(category);
    if (category === 'professional_advice') answer.text = 'I can explain published standards and sources. Consult a qualified professional for advice specific to you or your organization.';
    return {status, safety:answer};
  }
  return {status:'ok'};
}
