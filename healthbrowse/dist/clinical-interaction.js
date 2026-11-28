// Workflow routing only. These patterns do not diagnose, assign triage scores,
// establish source authority, or verify a clinician's credentials.
const domainRules=[
 ['Cardiology / hemodynamics',/\b(?:cardia\w*|hemodynamic\w*|nstemi|stemi|coronary|stent|DAPT|P2Y12|JVP|Kussmaul|pericard\w*|tricuspid|BNP)\b/i],
 ['Hepatology / gastroenterology',/\b(?:cirrhosis|Child[- ]Pugh|ascites|portal|PVT|varic\w*|hepat\w*|gastro\w*)\b/i],
 ['Nephrology / electrolytes',/\b(?:renal|kidney|nephro\w*|RPGN|hyponatr\w*|sodium|potassium|electrolyte\w*|anion gap|osmolar gap|acid[- ]base|delta[- ]delta)\b/i],
 ['Neurology / neurovascular',/\b(?:neuro\w*|mononeuritis|medullary|nucleus ambiguus|stroke|weakness|onconeural|paraneoplastic)\b/i],
 ['Rheumatology / immunology',/\b(?:rheumat\w*|vascul\w*|purpura|low C4|AOSD|Still.?s|Yamaguchi|autoimmun\w*)\b/i],
 ['Infectious disease / hematology',/\b(?:FUO|fever of unknown origin|prolonged fever|ferritin|HScore|sHLH|HLH|infect\w*|sepsis)\b/i],
 ['Clinical pharmacology / geriatrics',/\b(?:deprescrib\w*|de-prescrib\w*|polypharmacy|taper\w*|orthosta\w*|falls|escitalopram|chlorthalidone|tamsulosin|gabapentin|amiodarone)\b/i],
 ['Endocrinology / metabolism',/\b(?:thyro\w*|diabet\w*|adrenal|endocrin\w*|metabolic)\b/i]
];
const medicalDecision=/\b(?:manag\w*|treat\w*|differential|workup|work-up|diagnos\w*|calculate|interpret|distinguish|compar\w*|versus|vs\.?|trade[- ]?offs?|deprescrib\w*|taper\w*|antithrombot\w*|discordant|prioriti[sz]\w*)\b/i;
const patientCase=/\b(?:\d{1,3}\s*[MF]\b|\d{1,3}[- ](?:year|yr)[- ]old|patient|case|admitted|develops|presents|refractory|multisystem)\b/i;
export const clinicalDomains=question=>domainRules.filter(([,pattern])=>pattern.test(String(question))).map(([label])=>label);
export function complexClinicalQuestion(question){
 const q=String(question||''),domains=clinicalDomains(q);
 return medicalDecision.test(q) && (domains.length>=2 || (domains.length && (patientCase.test(q)||q.split(/\s+/).length>=24)));
}
export const bypassClinicalClarification=question=>/\b(?:skip|bypass|without|no)\s+(?:the\s+)?(?:clarification|clarifying questions|questions)|\bproceed (?:directly|with (?:explicit )?assumptions)\b/i.test(String(question));

export function validateClinicalContext(value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid clinician context.');
 const fields={perspective:100,setting:80,goal:140,caseQuestion:1600};
 if(Object.keys(value).some(key=>!Object.hasOwn(fields,key)&&!['depth','clarified'].includes(key)))throw Error('Unexpected clinician context.');
 for(const [key,max] of Object.entries(fields))if(value[key]!==undefined && (typeof value[key]!=='string'||value[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key])))throw Error('Invalid clinician context.');
 if(value.depth!==undefined&&!['rapid','full'].includes(value.depth))throw Error('Invalid clinical response depth.');
 if(value.clarified!==undefined&&typeof value.clarified!=='boolean')throw Error('Invalid clarification state.');
 return {...value};
}

export function inferClinicalContext(question,known={}){
 const q=String(question||''),context={...known};
 const roles=q.matchAll(/\b(?:I am|I'm|I’m|as (?:a|an)|role\s*[:=])\s*(?:a |an )?((?:(?:general|internal) medicine |general |interventional |clinical |non-invasive |cardiothoracic )?(?:resident|internist|hospitalist|physician|cardiologist|surgeon|hepatologist|nephrologist|rheumatologist|neurologist|pharmacist|nurse|researcher|medical student|clinician))/gi);
 const role=Array.from(roles).find(match=>!/(?:\bnot|\bnever|\bavoid|\bdon't|\bdon’t)\b[^.;?!]{0,30}$/i.test(q.slice(Math.max(0,match.index-40),match.index)));
 if(role)context.perspective=role[1];
 // Keep the original question untouched. Only explicit positive setting mentions
 // inform workflow preferences; "not in ICU" must not override "on the ward".
 const settingText=q.replace(/\b(?:not|never|no longer|isn't|isn’t|not currently)\s+(?:(?:in|on|at|an?|the|currently|being|managed)\s+){0,5}(?:ICU|intensive care|emergency department|emergency room|ED|acute floor|medicine ward|ward|inpatient|outpatient|clinic)\b/gi,'');
 if(/\b(?:ICU|intensive care)\b/i.test(settingText))context.setting='ICU';
 else if(/\b(?:emergency department|emergency room|ED|acute floor)\b/i.test(settingText))context.setting='Emergency / acute care';
 else if(/\b(?:ward|inpatient|hospitalist)\b/i.test(settingText))context.setting='Inpatient ward';
 else if(/\b(?:outpatient|clinic)\b/i.test(settingText))context.setting='Outpatient clinic';
 else if(/\b(?:academic|board review|teaching case|exam question)\b/i.test(settingText))context.setting='Academic / teaching';
 if(/\b(?:verify|verification|guideline|PDF)\b/i.test(q))context.goal='Source / guideline verification';
 else if(/\b(?:calculate|calculation|anion gap|osmolar gap|post-test|posttest)\b/i.test(q))context.goal='Calculation / workup sequence';
 else if(/\b(?:differential|diagnos\w*|workup|work-up|distinguish)\b/i.test(q))context.goal='Differential / workup prioritization';
 else if(/\b(?:manag\w*|treat\w*|trade[- ]?offs?|taper\w*|deprescrib\w*)\b/i.test(q))context.goal='Management evidence / trade-offs';
 if(/\b(?:thorough|detailed|full|comprehensive)\b/i.test(q))context.depth='full';
 else if(/\b(?:rapid|concise|brief|short answer)\b/i.test(q))context.depth='rapid';
 return context;
}

export function clinicalClarification(input){
 if(input.mode!=='chat'||input.role!=='Medical professional')return null;
 const q=input.question||'',context=inferClinicalContext(q,input.clinicalContext||{});
 if(context.clarified||bypassClinicalClarification(q)||!complexClinicalQuestion(q))return null;
 const domains=clinicalDomains(q),questions=[];
 if(!context.perspective||!context.setting){
  const role=!context.perspective?'Are you approaching this as a general internist / medicine resident or from a specific subspecialty':'';
  const setting=!context.setting?'is this outpatient, ward, emergency/ICU, or academic work':'';
  questions.push(role&&setting?role+', and '+setting+'?':role?role+'?':'What is the setting: outpatient, ward, emergency/ICU, or academic work?');
 }
 if(domains.includes('Cardiology / hemodynamics')&&domains.includes('Hepatology / gastroenterology'))questions.push('Is there active or recent bleeding, and which antiplatelet or anticoagulant medicines are already being used?');
 else if(/anion gap|osmolar gap|acid[- ]base|delta[- ]delta/i.test(q))questions.push('Which measured values, units, laboratory reference intervals and sampling times are available for the calculation?');
 else if(/deprescrib|taper|polypharmacy|falls/i.test(q))questions.push('What are the current medication doses and duration of use, and which adverse effect is the immediate concern?');
 else if(domains.includes('Neurology / neurovascular'))questions.push('What is the onset and time course, and which examination or imaging findings have been documented?');
 else questions.push('Which decision-changing findings or test results are confirmed, and which are still suspected or unavailable?');
 if(!context.depth||!context.goal)questions.push('Would you like a rapid decision summary or a full workup discussion, and which decision should it prioritize?');
 // Once all workflow fields are known, do not force a clinical-data questionnaire
 // for every follow-up. Missing patient variables are then explicit evidence gaps.
 if(context.perspective&&context.setting&&context.goal&&context.depth)return null;
 return {kind:'clinical',title:'Let’s focus the clinical question',
  text:'This appears to involve '+(domains.join('; ')||'General Internal Medicine')+'.',
  questions:questions.slice(0,3),choices:[{label:'Proceed with explicit assumptions',query:'Proceed directly with explicit assumptions.'}],allowEdit:true,
  caseQuestion:q,clinicalContext:context,editLabel:'Answer these questions'};
}

export function clinicalQuestionForTurn(question,context={}){
 const original=context.caseQuestion;
 return original&&context.clarified&&original!==question
  ?original+'\n\nClinician clarification / current follow-up: '+question:question;
}
export function clinicalPreferences(context={}){
 return Object.fromEntries(['perspective','setting','goal','depth'].filter(k=>context[k]).map(k=>[k,context[k]]));
}

export function resolveClinicalTurn(question,{pending=null,caseQuestion='',preferences={}}={}){
 const explicitNew=/^\s*(?:new (?:case|patient|question)|another patient|different patient)\b/i.test(question);
 const newPatient=/^\s*(?:\d{1,3}\s*[MF]\b|(?:a |an )?\d{1,3}[- ](?:year|yr)[- ]old\b)/i.test(question);
 const differentTopic=/^(?:what (?:is|are)|explain|describe|tell me about)\s/i.test(question)
  &&!/\b(?:his|her|their|this|that|these|those|its|the patient|our patient|my patient)\b/i.test(question);
 // A detailed clarification can itself contain multiple clinical domains. It
 // is still a reply to the pending case, not permission to discard that case.
 const newCase=explicitNew||newPatient||(!pending&&differentTopic);
 const original=!newCase?(pending?.caseQuestion||caseQuestion):'';
 const context=inferClinicalContext(question,preferences);
 if(original)Object.assign(context,{caseQuestion:original,clarified:true});
 return {question:clinicalQuestionForTurn(question,context),context,caseQuestion:original||(complexClinicalQuestion(question)?question:'')};
}
