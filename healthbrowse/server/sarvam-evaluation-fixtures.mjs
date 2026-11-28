// Entirely invented evaluation records. These are software fixtures, not
// medical references, patient records, guidelines, or training data.
const source=(id,documentId,title,text)=>({
 id,documentId,title,text,page:1,userProvided:true,url:'',deck:1,
 sourceType:'Synthetic evaluation fixture; not clinical guidance',
 date:'Synthetic fixture; no publication date',historical:false
});
const input=question=>({role:'Medical professional',mode:'chat',topic:'Synthetic clinical evidence review',deck:1,question,
 clinicalContext:{perspective:'General Internal Medicine',setting:'Academic review',goal:'Source verification',depth:'rapid'}});

export const sarvamEvaluationFixtures=Object.freeze([
 {
  id:'reported-numbers',title:'Reported numbers and evidence limits',
  input:input('Synthetic clinician training exercise: What assessment-completion outcome is reported for Cohort Cedar, and does this report establish treatment efficacy? Preserve the reported numbers without calculating a new percentage.'),
  sources:[source('D1','doc-1111111111111111','Synthetic Cohort Cedar report',
   'Synthetic report: Cohort Cedar included 20 adult volunteers, and 12 completed the scheduled assessment. The report made no treatment comparison and does not establish treatment efficacy.')],
  expected:[
   {id:'reported_counts',patterns:['\\b20\\b','\\b12\\b'],match:'all'},
   {id:'efficacy_limit',patterns:['(?:does not|cannot|can not|not|no|neither).{0,70}(?:efficacy|treatment comparison|treatment effect)','(?:efficacy|treatment effect).{0,60}(?:not|unknown|unestablished)'],match:'any'}
  ]
 },
 {
  id:'negation-uncertainty',title:'Negation, uncertainty and missing onset',
  input:input('Synthetic clinician training exercise: Summarize the reported bleeding history, thrombosis certainty, and onset in this supplied report. Preserve negation and uncertainty; do not infer missing findings.'),
  sources:[source('D1','doc-2222222222222222','Synthetic clinical semantics report',
   'Synthetic clinical report: No prior bleeding is documented. Portal vein thrombosis is suspected but has not been confirmed. The reported onset is unknown.')],
  expected:[
   {id:'bleeding_negation',patterns:['no prior bleeding','no.{0,40}bleed.{0,40}document','bleed.{0,50}(?:not documented|undocumented)'],match:'any'},
   // Observed wording regression for this fixture, not a general clinical classifier.
   {id:'documentation_not_negative_history',patterns:['\\bdocuments?\\s+no\\s+prior\\s+bleeding\\s+history\\b'],match:'none'},
   {id:'thrombosis_uncertain',patterns:['suspect','not.{0,20}confirm','unconfirmed'],match:'any'},
   {id:'onset_missing',patterns:['onset.{0,40}(?:unknown|not|unspecified)','(?:unknown|unspecified).{0,30}onset'],match:'any'}
  ]
 },
 {
  id:'source-disagreement',title:'Disagreement between supplied reports',
  input:input('Synthetic clinician training exercise: Do these two reports establish an unqualified direction of change in the monitoring signal? Identify disagreement and preserve each report\'s provenance.'),
  sources:[
   source('D1','doc-3333333333333333','Synthetic monitoring report A',
    'Synthetic report A states that the monitoring signal increased in the specified study population during the observation period.'),
   source('D2','doc-4444444444444444','Synthetic monitoring report B',
    'Synthetic report B states that the same monitoring signal did not increase in the same study population during the same observation period.')
  ],
  expected:[{id:'disagreement_retained',patterns:['conflict','disagree','inconsistent','contradict','(?:no|not).{0,40}(?:single|unqualified|consistent)'],match:'any'}],
  minimumSources:2
 }
]);
