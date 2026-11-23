import {clinicalSections} from '../dist/clinical-sections.js';

// Software/coverage checks and review suggestions, not a medical-certification bot.
const textOf=s=>s?.blocks?.map(b=>b.text).join(' ')||s?.text||'';
export function auditResponse(testCase,role,status,result,elapsedMs){
 const findings=[];
 const add=(severity,check,detail,suggestion)=>findings.push({severity,check,detail,suggestion});
 if(testCase.expectedCode){
  if(status!==422||result.code!==testCase.expectedCode)add('error','safety-interceptor','Expected '+testCase.expectedCode+' before inference.','Repair the privacy/emergency admission path before release.');
  return {passed:!findings.length,findings};
 }
 if(status!==200||!['generated','sourced'].includes(result.status)){
  const provider=/provider_busy|rate_limited/.test(result.code||'');
  add('error',provider?'provider-capacity':'response-availability',result.code||'HTTP '+status,provider?'Review provider allowance and request spacing; this is an infrastructure failure, not evidence of model hallucination.':'Inspect the gateway/provider error and restore a complete response.');
  return {passed:false,findings};
 }
 const answerBlock=result.answer||{};
 const hasGeneration=Boolean(answerBlock?.generation);
 if(!textOf(answerBlock).trim())add('error','direct-answer','The answer is empty.','Render a direct answer or explain what evidence is missing.');
 if(!hasGeneration)add('review','generated-answer','Only a source excerpt or gap was returned.','Inspect retrieval coverage and provider availability.');
 if(result.decks!==undefined&&(!Array.isArray(result.decks)||result.decks.length)){
  add('error',testCase.mode==='chat'?'buddy-focus':'browser-format','The response includes an unexpected deck collection.','Return only the answer to the current question.');
 }
 if(testCase.mode==='search'&&role==='Clinicians'){
  if(!answerBlock?.clinicalSynthesis)add('error','clinical-format','The clinical report flag is missing.','Return the clinician report with sections for synthesis, evidence and limitations.');
  const groups=clinicalSections(answerBlock);
  const keys=new Set(groups.map(g=>g.key));
  if(hasGeneration&&(answerBlock.blocks||[]).some(b=>!b.kind&&!keys.has(b.section)))add('error','clinical-claim-section','A generated clinical claim is missing its report section.','Assign each supported claim to synthesis, evidence or limitations.');
  if(groups.map(g=>g.key).join(',')!=='synthesis,evidence,limitations'||groups.some(g=>!g.blocks.length&&!g.notes.length))add('error','clinical-sections','The clinical report lacks a section or an explanation of a gap.','Show all three sections with cited findings or a source limitation.');
 }
 if(role==='General'&&answerBlock?.clinicalSynthesis)add('error','general-format','The General response has been marked as a clinician report.','Use the plain-language reader view.');
 if(hasGeneration&&!answerBlock?.blocks?.length)add('error','missing-citation','The generated answer contains no claim-level source records.','Return the direct claim with the passage that supports it.');
 for(const block of answerBlock?.blocks||[]){
  if(block.kind==='follow-up')continue;
  const references=block.references?.length?block.references:block.citation?[block.citation]:[];
  if(block.kind==='diagnosis-lead'&&!references.length)continue;
  if(!references.length)add('error','missing-citation','A medical answer block lacks a citation.','Withhold the claim until it has a supporting source.');
  for(const ref of references){
   let valid=false;try{const u=new URL(ref.url);valid=u.protocol==='https:'&&!u.username&&!u.password;}catch{}
   if(!valid||!ref.id||!ref.quote||!ref.text?.includes(ref.quote))add('error','source-integrity','The answer contains an invalid citation or quotation.','Resolve URLs and quotations from server-owned evidence.');
   if(!ref.date)add('review','source-date','A cited passage has no source date.','Display its publication or snapshot date when verified.');
  }
  if(hasGeneration&&!/[.!?]["”’)]?$/.test(block.text.trim()))add('error','unfinished-answer','An answer block contains an unfinished sentence.','Reject truncated model output.');
 }
 const answer=textOf(result.answer).toLowerCase();
 for(const facet of testCase.facets||[])if(!facet.terms.some(t=>answer.includes(t)))add('review','question-coverage','Direct answer may miss: '+facet.name+'.','Review this facet semantically and add supported information or explicitly state the evidence gap.');
 if(role==='General'&&/\b(hematopoiesis|cytopenia|clonal|immunophenotyp|etiopathogenesis|myeloblast)\b/i.test(answer)&&!/(?:means|called|which|a type of|immature)/i.test(answer))add('review','plain-language','Possible unexplained clinical terminology.','Define unfamiliar terms in ordinary language for General users.');
 if(role==='Clinicians'&&answer.split(/\s+/).length<25)add('review','clinical-depth','The clinician answer is very short.','Add source-supported diagnostic or mechanistic context appropriate to the question.');
 if(elapsedMs>30000)add('review','latency','Response took '+Math.round(elapsedMs/1000)+' seconds.','Investigate provider timing, source budget and capacity. Keep progress and cancellation visible.');
 return {passed:!findings.some(f=>f.severity==='error'),findings};
}
export function compareModes(records){
 const findings=[];
 for(const general of records.filter(r=>r.role==='General'&&!r.testCase.expectedCode)){
  const clinician=records.find(r=>r.role==='Clinicians'&&r.testCase.id===general.testCase.id);
  const a=textOf(general.result?.answer),b=textOf(clinician?.result?.answer);
  if(a&&a===b)findings.push({severity:'review',case:general.testCase.id,check:'audience-difference',detail:'The two modes returned identical direct answers.',suggestion:'Inspect role prompting and evidence depth; similar answers may be appropriate for a simple fact, but clinical questions need appropriate detail.'});
 }
 return findings;
}
export function reportMarkdown(report){
 const lines=['# HealthBrowse QA bot report','',`Run: ${report.createdAt}`,`Execution: ${report.execution}`,'',`Software checks passed: ${report.summary.passed}/${report.records.length}. Review suggestions: ${report.summary.reviewFindings}.`,'','These are automated software, citation-integrity and coverage checks. A pass is not clinical certification. Coverage keywords are prompts for human review, not proof of medical correctness.','','| Case | Mode | Status | Time | Findings |','| --- | --- | --- | --- | --- |'];
 for(const r of report.records)lines.push(`| ${r.testCase.id} | ${r.role} | ${r.audit.passed?'Pass':'Fail'} | ${(r.elapsedMs/1000).toFixed(1)}s | ${r.audit.findings.length} |`);
 for(const r of report.records)for(const f of r.audit.findings)lines.push('',`## ${r.testCase.id} · ${r.role} · ${f.check}`,`${f.severity.toUpperCase()}: ${f.detail}`,`Suggested change: ${f.suggestion}`);
 for(const f of report.comparisons)lines.push('',`## ${f.case} · ${f.check}`,f.detail,`Suggested change: ${f.suggestion}`);
 return lines.join('\n')+'\n';
}
