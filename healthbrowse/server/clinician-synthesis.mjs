import {normalizeReadingRole} from '../dist/reading-profiles.js';
import {applyDiagnosisResponse} from '../dist/diagnosis-response.js';
import {clinicalDomains,clinicalPreferences} from '../dist/clinical-interaction.js';
import {compactClinicalBuddyPrompt,clinicalSemanticReview,clinicalPromptVersion} from './clinical-prompt.mjs';

export const clinicalSections=['synthesis','evidence','limitations'];
export const clinicalMode=(input,evidence)=>(!evidence.documentMode || evidence.clinicalDocument===true) && normalizeReadingRole(input.role)==='Medical professional';
export const containsReasoningTag=text=>/<\s*\/?\s*(?:think|thinking|reasoning|analysis)\b/i.test(String(text));

export const clinicianProtocol=compactClinicalBuddyPrompt+`\nRUNTIME CONTRACT: This is the synthesis stage; the application has handled clarification or the user has chosen to proceed. Return only the requested claim JSON. Use an objective peer-to-peer clinical tone throughout, including follow-ups. Apply an internist perspective: prioritize supported likely and time-critical differentials, discriminating findings, pathophysiology, diagnostic stewardship, competing risks and conditional therapeutic trade-offs. State why a supported test or next step changes the decision. Correct an unsupported premise respectfully; never imply certainty from missing evidence. Label each direct answer claim with a section: synthesis (the executive answer), evidence (mechanism, diagnostic criteria, or management evidence relevant to the question), or limitations (documented limitations, contraindications, or conflicts). Include each section when the context supports it; omit unsupported claims. Identify the applicable population, intervention, comparator and outcome only when relevant and supplied. Report study design, quality and applicability only when the passages document them. Include a red-flag differential only when a retrieved source supports it for this presentation. A research abstract or patient education page does not establish a guideline. Base any guideline recommendation, adverse interaction, off-label indication or contraindication strictly on the retrieved passage and its source type. Never infer a dose or regimen. Attribute divergent findings to their respective sources and cite both sides; distinguish study populations and endpoints if documented. If the evidence cannot resolve a question, leave its conclusion open. Return only the structured clinical answer and supporting evidence. Keep private reasoning out of all output fields.`;

export const clinicianReview=clinicalSemanticReview+` For a clinician claim, review all supplied material for materially conflicting evidence as well as supporting passages. Withhold an unqualified conclusion if relevant sources conflict. Accept a claim explaining a conflict only when the selected passages substantiate both positions. Reject comparisons across incompatible populations, unsupported design/quality labels, causal conclusions from associations, and recommendations inferred from abstracts. Every red-flag differential, dose, contraindication, interaction, off-label use, and numeric outcome must be explicitly supported within the cited population and time frame. The exact cited spans and their supplied provenance must support the full claim.`;

export function clinicalClaimLimit(input){
 return input.clinicalContext?.depth==='full'||/\b(?:thorough|detailed|full|comprehensive)\b/i.test(input.question||'')?12:6;
}

export function claimSection(value,index) {
 if(value===undefined)return index===0?'synthesis':'evidence'; // Legacy provider outputs
 return clinicalSections.includes(value)?value:null;
}

// This check is independent of the model's support verdict. In particular, a
// genuine quotation about a different result cannot justify a new percentage.
export function quantitativeSupport(claim,quotes) {
 const values=text=>Array.from(text.replaceAll('−','-').matchAll(/(?:(?<![a-z\d])[-+])?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:\s*(%|percent\b|per cent\b))?/gi),
  ([token,percent])=>Number.parseFloat(token.replaceAll(',',''))+(percent?'%':''));
 const evidence=new Set(values(quotes.join(' ')));
 if(!values(claim).every(value=>evidence.has(value)))return false;
 // Compare complete dose expressions. A matching number alone says nothing
 // about its unit or whether it applies per kilogram, per dose, or per day.
 const doseUnits=text=>text.toLowerCase().replace(/[μµ]/gu,'u')
  .replace(/\b(?:micrograms?|mcg)\b/g,'ug').replace(/\bmilligrams?\b/g,'mg')
  .replace(/\bmillilit(?:er|re)s?\b/g,'ml').replace(/\bkilograms?\b/g,'kg')
  .replace(/\bgrams?\b/g,'g').replace(/\b(?:hours?|hrs?)\b/g,'h')
  .replace(/\bper\b/g,'/').replace(/\bsquare met(?:er|re)s?\b/g,'m2').replace(/m²/g,'m2');
 const doses=text=>Array.from(doseUnits(text).matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*(mg|ug|ng|g|ml|iu|units?|mmol)\b((?:\s*\/\s*(?:kg|g|ml|l|m2|day|h|week|minute|dose)\b)*)/g),
  ([,value,unit,denominator])=>Number(value.replaceAll(',',''))+unit.replace(/^units$/,'unit')+denominator.replace(/\s/g,''));
 const reported=new Set(quotes.flatMap(doses));
 return doses(claim).every(dose=>reported.has(dose));
}
export function exactQuotes(checked,claim,map) {
 if(!Array.isArray(checked.sources)||!checked.sources.length||checked.sources.length>3||new Set(checked.sources).size!==checked.sources.length)return null;
 // Older responses can still be verified when the statement itself occurs verbatim.
 // A supplied incorrect quotation, however, must never be replaced silently.
 const spans=checked.quotes===undefined?checked.sources.map(()=>claim.text):checked.quotes;
 if(!Array.isArray(spans)||spans.length!==checked.sources.length)return null;
 const valid=spans.every((span,i)=>typeof span==='string' && span.trim().length>=10 && span.length<=900 && map.get(checked.sources[i])?.text.includes(span.trim()));
 return valid?spans.map(span=>span.trim()):null;
}

export function finishMedicalAnswer(answer,input,evidence,options) {
 const result=evidence.documentMode?answer:applyDiagnosisResponse(answer,input,{...options,sources:evidence.sources});
 if(!clinicalMode(input,evidence))return result;
 const workflow=clinicalPreferences(input.clinicalContext);
 return {...result,clinicalSynthesis:true,clinicalInteraction:{promptVersion:clinicalPromptVersion,
  domains:clinicalDomains(input.question),role:workflow.perspective||'General Internal Medicine',
  setting:workflow.setting||'Not specified',goal:workflow.goal||'Clinical evidence review',depth:workflow.depth||'rapid'},
  ...(evidence.visual?{clinicalVisual:evidence.visual}:{})};
}
