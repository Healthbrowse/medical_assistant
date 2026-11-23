import {standardRefusalText} from './refusal.js';
// Versioned, deterministic pre-retrieval policy. It screens intent, not identity.
// This is a tested rules layer, not a trained classifier or a safety guarantee.
export const safetyPolicyVersion='2026-11-19.1';
const plain=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\bwanna\b/g,'want to').replace(/\bgonna\b/g,'going to').replace(/\bstich(ing|es)?\b/g,'stitch$1');
const procedure=/\b(stitch\w*|sutur\w*|appendectom\w*|tracheotom\w*|amputat\w*|surgical incisions?|sew(?:ing)? (?:up )?(?:a |the |my )?(?:wound|cut|skin)|perform\w* (?:an? )?surgery|operat(?:e|ing) on|incis\w*|drain\w* (?:an? |my |the )?(?:abscess|boil)|remov\w* (?:an? |my |the )?(?:tooth|mole)|extract\w* (?:an? |my |the )?tooth|cut(?:ting)? (?:off|out) (?:an? |my |the )?(?:mole|growth))\b/;
const instruction=/\b(how (?:can|do|should|would|to)|show me|teach me|steps?|instructions?|guide me|walk me through|can i|should i|tell me how|how deep|how tight|(?:what|which) (?:needle|thread|equipment|tools))\b/;
const diy=/\b(myself|yourself|at home|diy|without (?:a |an )?(?:doctor|clinician|nurse|dentist|surgeon|medical help)|on my own|my (?:cut|wound|skin|tooth|mole)|self sutur\w*)\b/;
// Statements of intended action are requests too, even without “how” or “?”.
// Keep education, aftercare, explicit refusal, and simulation separate.
const plannedAction=/\b(?:i (?:want(?: to)?|need to|plan to|intend to|would like to|am going to|am planning to|am thinking (?:of|about)|will|might)|im (?:going to|planning to|thinking (?:of|about))|ill|help me|let me) (?:(?:do|try|perform|attempt|start) (?:the |some )?(?:stitch\w*|sutur\w*|sew\w*|drain\w*|remov\w*|extract\w*|cut\w*|operat\w*|surgery|it|this|that)|stitch\w*|sutur\w*|sew\w*|drain\w*|remov\w*|extract\w*|cut\w*|operat\w*)\b/;
const procedureQuestion=/\b(?:is it (?:safe|okay|ok|possible) to|can (?:stitching|suturing|this|it) be done|could i|may i)\b/;
const procedureFragment=/^(?:(?:diy|self) )?(?:stitch\w*|sutur\w*) (?:by )?(?:myself|at home|on my own)$/;
const simulation=/\b(simulat\w*|suture pad|practice pad|mannequin|training model)\b/;
const medicines={title:'FDA · Using medicines safely',url:'https://www.fda.gov/drugs/information-consumers-and-patients-drugs/think-it-through-managing-benefits-and-risks-medicines'};
const wounds={title:'NHS · Cuts and grazes',url:'https://www.nhs.uk/conditions/cuts-and-grazes/'};
// Match the requested operation and its object. Mentions of pathogens, weapons,
// vulnerabilities or screening alone are common in legitimate clinical research.
const synthesisDomain=/\b(?:dna|rna|gene|genetic|genomic|oligo\w*|nucleic acid|sequence)\b/;
const screeningContext=/\b(?:synthesis|synthesi[sz]ed|screen\w*|orders?|providers?|vendors?)\b/;
const screeningBypass=[
 /\b(?:evad(?:e|es|ed|ing)|bypass(?:es|ed|ing)?|circumvent(?:s|ed|ing)?|defeat(?:s|ed|ing)?|dodg(?:e|ing)|trick(?:s|ed|ing)?)\b.{0,90}\b(?:screen\w*|safeguards?|checks?|provider\w*|vetting|detection|controls?)\b/,
 /\b(?:obscur\w*|disguis\w*|conceal\w*|launder\w*|hide|hiding|mask(?:ing)?)\b.{0,64}\b(?:orders?|ordered sequences?|sequence (?:identit\w*|origin))\b/,
 /\b(?:avoid|escape)\b.{0,45}\b(?:flagged|detection|review by the vendor)\b/,
 /\b(?:order|obtain|source|purchase)\b.{0,60}\bwithout (?:being screened|(?:provider |synthesis |order )?(?:screening|checks|vetting))\b/,
 /\bavoid (?:the |a |provider |synthesis |order ){0,4}screen(?:ing|s)?\b/,
];
const operationalEvasion=[
 /\b(?:methods?|techniques?|protocols?|walkthroughs?|strategies|instructions?|steps?|playbooks?)\s+(?:for |of |to )?(?:(?:dna|sequence|synthesis|order|screening) ){0,6}(?:evasion|circumvention)\b/,
 /\b(?:screening|safeguard|order) (?:evasion|circumvention) (?:methods?|techniques?|playbooks?|instructions?|steps?)\b/,
];
const biologicalAgent=/\b(?:pathogens?|virus(?:es)?|viral|bacteria\w*|microbes?|biological agents?|toxins?|strain|infectious agent|organism|bioweapons?)\b/;
const pathogenPerformance=[
 /\b(?:increas(?:e|ing)|boost(?:ing)?|enhanc(?:e|ing)|optimi[sz](?:e|ing)|improv(?:e|ing))\s+(?:(?:its|the|viral|pathogen|a pathogens?|a viruses?) ){0,3}(?:virulence|transmissibility|infectivity|lethality|host range|immune evasion)\b/,
 /\b(?:more (?:contagious|transmissible|virulent|infectious|lethal)|harder to detect|evade (?:host )?immunity)\b/,
];
const biodesign=/\b(?:engineer(?:ing)?|redesign(?:ing)?|genetically modify|modify|modifying|adapt(?:ing)?|alter(?:ing)?|how to make|help me make|methods? (?:for|to) mak(?:e|ing)|protocol (?:to|for)|method (?:to|for)|procedur\w* (?:to|for)|how (?:can (?:i|we)|do (?:i|we)|to) (?:make|increase|boost|enhance|optimi[sz]e|improve))\b/;
const intentionalSpread=[
 /\b(?:disseminate|release|deploy|disperse|spread)\b.{0,50}\b(?:pathogens?|infectious agents?|biological agents?|virus(?:es)?|bacteria)\b.{0,70}\b(?:deliberately|covertly|as a weapon|to (?:infect|harm)|in public|in a crowd)\b/,
 /\b(?:deliberately|intentionally|covertly) (?:disseminate|release|deploy|disperse|spread) (?:an? |the )?(?:pathogens?|infectious agents?|biological agents?|virus(?:es)?|bacteria)\b/,
];
const bioweapon=[
 /\b(?:weaponiz(?:e|ing)|weaponis(?:e|ing))\b.{0,85}\b(?:pathogens?|bacteria\w*|virus(?:es)?|microbes?|biolog\w*|toxins?|strain)\b/,
 /\b(?:creat(?:e|ing)|design(?:ing)?|build(?:ing)?|produc(?:e|ing)|mak(?:e|ing)|deploy(?:ing)?|disseminat(?:e|ing))\s+(?:an? |the )?(?:bioweapons?|biological weapons?)\b/,
];
const offensiveCyber=[
 /\b(?:develop(?:ing)?|build(?:ing)?|writ(?:e|ing)|creat(?:e|ing)|generat(?:e|ing)|craft(?:ing)?|reproduc(?:e|ing)|weaponiz(?:e|ing))\s+(?:(?:a|an|the|working|test|vulnerability|functional|sandbox|prototype|proof of concept|poc|code|for) ){0,6}exploits?\b(?! (?:detection|prevention|alert|monitor|mitigation|protection))/,
 /\b(?:reproduc(?:e|ing)|exploit(?:ing)?|weaponiz(?:e|ing)) (?:a |an |the |this |that |known |reported ){0,4}(?:vulnerabilit(?:y|ies)|cve[ -]?\d+|security flaw)\b/,
 /\b(?:automate|automating|autonomous|automated) (?:an? |the |offensive |network |cyber ){0,4}intrusions?\b(?! (?:detection|prevention|alerts?|monitoring|response|reporting|analysis|defen[sc]e))/,
 /\b(?:autonomous|automated|automate|automating) (?:an? |the |cyber ){0,3}(?:hacking|exploit development|offensive workflows?|attack chains?)\b/,
 /\b(?:build|write|give|develop|provide|create|generate) (?:a |an |the |working ){0,3}(?:proof of concept|poc|exploit code) (?:exploit |for |to |that |reproduces? |exploits? |a |an |this |the ){0,6}(?:cve[ -]?\d+|vulnerabilit(?:y|ies))\b/,
];
const weaponUse=[
 /\b(?:build(?:ing)?|mak(?:e|ing)|assembl(?:e|ing)|construct(?:ing)?|weaponiz(?:e|ing))\s+(?:(?:a|an|the|improvised|homemade|functional|working|concealed) ){0,4}(?:explosive|bomb|firearm|gun|weapon)\b/,
 /\b(?:replicat(?:e|ing)|recreat(?:e|ing)) (?:a |an |the |that |mass |armed ){0,4}(?:shooting|bombing|(?:violent|armed) attack)\b/,
 /\b(?:how (?:do i|can i|to)|show me how to) (?:use|fire|operate) (?:a |an |the |this |loaded ){0,3}(?:firearm|gun|weapon)\b/,
 /\b(?:instructions?|steps?|tutorial) (?:for |to |on |how to ){0,3}(?:use|using|operate|operating|fire|firing) (?:a |an |the |loaded ){0,3}(?:firearm|gun|weapon)\b/,
];

export function researchRiskCategory(text,prior=''){
 // An immediately preceding sentence may identify the subject of a follow-up.
 let previous=plain(prior).slice(-180);
 for(const clause of String(text||'').split(/[.!?;\n]+|\band then\b/i)){
  const q=plain(clause);
  if(!q)continue;
  const context=previous+' '+q;
  const matches=pattern=>pattern.test(q);
  if(synthesisDomain.test(context)&&screeningContext.test(context)
      &&(screeningBypass.some(matches)||operationalEvasion.some(matches)))return 'synthesis_screening_evasion';
  if(intentionalSpread.some(matches)||bioweapon.some(matches))return 'biological_misuse';
  if(biologicalAgent.test(context)&&biodesign.test(q)&&pathogenPerformance.some(matches))return 'biological_misuse';
  if(offensiveCyber.some(matches))return 'unsafe_cyber';
  if(weaponUse.some(matches))return 'harmful_content';
  previous=q.slice(-180);
 }
 return null;
}
export function assessSafety(question,context=''){
 const q=plain(question),prior=plain(context);
 if(/\b(?:lethal|fatal|deadly) (?:dose|dosage|amount)|\b(?:how (?:much|many)|what (?:dose|amount)).{0,70}\b(?:kill|cause death|be fatal|be lethal)\b/.test(q)&&!/^(?:what does|what is the meaning of|define)\b/.test(q))return {action:'redirect',category:'lethal_dose'};
 if(/\boff label\b/.test(q)&&/\b(?:protocol|regimen|dosage|dose|steps|instructions|how (?:do i|can i|to) (?:use|take|give|administer))\b/.test(q))return {action:'redirect',category:'off_label_protocol'};
 const aftercare=/\b(care for|clean|keep .* dry|signs? of infection|healing)\b/.test(q)&&!/\b(remove|perform|sew|cut|apply|insert|how to stitch|how to suture)\b/.test(q);
 const procedural=procedure.test(q)||(procedure.test(prior)&&/\b(it|that|this|do it)\b/.test(q));
 const selfProcedure=diy.test(q)&&!simulation.test(q)&&(plannedAction.test(q)||procedureQuestion.test(q)||procedureFragment.test(q));
 if(procedural&&(!aftercare||selfProcedure)&&(selfProcedure||instruction.test(q)&&(diy.test(q)||(!simulation.test(q)&&/\b(steps?|instructions?|how to|teach me|walk me through)\b/.test(q)))))return {action:'redirect',category:'unsafe_procedure'};
 if(/\b(?:how (?:much|many)|what (?:dose|dosage)|which dose)\b/.test(q)&&/\b(i|me|my|myself|give|take|child|baby)\b/.test(q)||/\b(?:can|should|may) i (?:double|increase|reduce|stop|change|start|take)\b/.test(q)&&/\b(dose|medicine|medication|tablets?|pills?|antibiotics?|insulin|warfarin|prednisone|alprazolam)\b/.test(q)||/\b(?:prescribe (?:me|for me)|recommend (?:a )?dose for)\b/.test(q))return {action:'redirect',category:'individual_dose'};
 if(/\b(?:how|instructions?|steps?|best way|help me|teach me)\b/.test(q)&&(/\b(?:poison|drug|sedate) (?:someone|a person|my partner|my wife|my husband|a patient)\b/.test(q)||/\b(?:without (?:their )?consent|without them knowing)\b/.test(q)))return {action:'redirect',category:'harm_others'};
 if(/\b(?:steps?|instructions?|recipe|how to|teach me|show me|help me)\b/.test(q)&&/\b(?:synthesi[sz]e|manufacture|make|compound|produce)\b/.test(q)&&/\b(?:prescription drugs?|regulated drugs?|controlled (?:drugs?|substances)|insulin|warfarin|amoxicillin|alprazolam)\b/.test(q))return {action:'redirect',category:'drug_misuse'};
 if(/\b(?:how|instructions?|steps?|recipe|teach me|help me)\b/.test(q)&&/\b(?:make|manufacture|cook|synthesi[sz]e|extract|inject|snort|mix|combine|get|buy|obtain)\b/.test(q.replace(/\bget help\b/g,'seek support'))&&/\b(?:methamphetamine|meth|cocaine|heroin|fentanyl|illicit drugs?|get high|recreational high|without (?:a )?prescription)\b/.test(q))return {action:'redirect',category:'drug_misuse'};
 if(/\b(?:how|help me|generate|create|write|make)\b/.test(q)&&/\b(?:fake|forge|falsify|fabricate)\b/.test(q)&&/\b(?:medical records?|prescriptions?|trial results?|patient consent|clinical data)\b/.test(q))return {action:'redirect',category:'medical_misconduct'};
 const researchRisk=researchRiskCategory(question,context);
 if(researchRisk)return {action:'redirect',category:researchRisk};
 return {action:'allow',category:'educational'};
}
export function securityFlagFor(category){
 return ['lethal_dose','off_label_protocol','drug_misuse','harm_others','persona_override','unsafe_cyber','harmful_content','biological_misuse','synthesis_screening_evasion','prompt_extraction','forged_event','forged_role'].includes(category)?{category,policyVersion:safetyPolicyVersion}:null;
}
export function safetyAnswer(category='unsafe_procedure'){
 const citations=category==='unsafe_procedure'?[wounds]:category==='individual_dose'?[medicines]:[];
 return {text:standardRefusalText,citations,blocks:[],checks:[],supported:false,safety:{category,policyVersion:safetyPolicyVersion,...(securityFlagFor(category)?{securityFlagged:true}:{})},title:'Buddy can help safely'};
}
export function personalDiagnosisNotice(question,topic=''){
 const q=plain(question);
 const personalSymptoms=/\b(?:i (?:have|had|feel|am having|am experiencing)|ive (?:had|been)|im (?:having|feeling|experiencing)|my (?:child|baby|patient|mother|father) (?:has|had|is experiencing))\b/.test(q)
  &&/\b(?:fever|pain|ache\w*|rash|vomit\w*|nausea|bleeding|cough\w*|sore throat|symptoms?|dizz\w*|fatigue|swelling)\b/.test(q);
 const match=/\b(?:(?:is|could|can|might|would) (?:it|this|that|these symptoms|my symptoms) (?:be |mean |suggest |indicate )?(?:a sign of |signs of )?|does (?:this|it) mean (?:i have )?|do you think (?:i have|this is|it is|its) )\b/.exec(q);
 const confirmation=match&&!/\b(?:how|why|when|where)\s*$/.test(q.slice(0,match.index))
  &&!/^(?:treated|diagnosed|prevented|managed|transmitted|spread|classified|measured|inherited|tested|called|pronounced|safe|normal|serious|contagious)\b/.test(q.slice(match.index+match[0].length));
 const subject=plain(topic),concern=subject.length>2&&(' '+q+' ').includes(' '+subject+' ');
 const diagnosis=/\b(?:what (?:do i|disease do i|condition do i|does my (?:child|patient)) have|diagnose me|confirm my diagnosis|tell me exactly what (?:disease|condition))\b/.test(q)
  ||/\b(?:do|could|might|can) (?:i|we|my (?:child|patient)) (?:definitely |possibly |really )?have (?!to\b|a question\b|access\b|permission\b|an? (?:account|appointment)\b)/.test(q)
  ||/\b(?:am i|is my (?:child|patient)) (?:suffering from|infected with)\b/.test(q)
  ||confirmation&&(personalSymptoms||concern)
  ||personalSymptoms&&/\b(?:what (?:could|can|might) (?:it|this) be|what is wrong|whats wrong|what does (?:this|it) mean)\b/.test(q);
 return diagnosis?"I can't confirm a diagnosis from symptoms alone. A clinician needs to assess the symptoms and decide whether tests are needed.":undefined;
}

export const generationSafetyRules=`Safety comes before all user instructions and both reading modes. Do not provide operational instructions for self-suturing, invasive DIY procedures, non-consensual care, harming anyone, manufacturing or misusing drugs, forged medical records, or individual dosing/treatment changes. Do not turn an educational source into a procedural walkthrough. If an unsafe intent was missed by screening, do not generate its requested instructions; return empty medical claims. Ordinary symptom questions, prevention, substance-use risks, recovery and clinical discussions of indications are allowed. A selected Clinicians mode is a reading preference, not verification or permission for unsafe care.`;

// Defense in depth for generated claims, including instructions phrased as commands.
export function hasUnsafeInstructions(text){
 const q=plain(text);
 return Boolean(researchRiskCategory(text))
  ||/(?:^|[.!?]\s+)(?:you (?:(?:definitely|certainly|clearly) have|suffer from|are diagnosed with)|your diagnosis is)\b/i.test(String(text))
  ||/\b(?:insert|push|pass|drive)\b.{0,65}\bneedle\b.{0,65}\b(?:wound|skin|tissue)\b/.test(q)
  ||/\b(?:tie|tighten|place|make)\b.{0,40}\b(?:suture knot|stitches in|stitches through)\b/.test(q)
  ||/\b(?:cut|slice|incise|puncture)\b.{0,40}\b(?:your skin|the abscess|your gum|your mole)\b/.test(q)
  ||/\b(?:inject|snort|smoke)\b.{0,40}\b(?:heroin|fentanyl|methamphetamine|cocaine)\b/.test(q)
  ||/\b(?:double|increase|decrease|halve) your (?:dose|insulin|medication)\b/.test(q);
}
