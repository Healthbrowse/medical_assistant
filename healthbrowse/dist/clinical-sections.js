import {isDocumentReference} from './document-policy.js';

const sectionTitles = {
  synthesis: 'Clinical Synthesis',
  evidence: 'Evidence Breakdown',
  limitations: 'Limitations & Contraindications'
};

function identifiedSource(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const rawId = ref.id ?? ref.source_id ?? ref.sourceId ?? ref.record;
  const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim()
    : /^[1-9]\d*$/.test(String(ref.pmid ?? '')) ? 'PMID: ' + ref.pmid : '';
  if (!id) return null;
  if (!isDocumentReference(ref)) {
    try {
      const url = new URL(ref.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    } catch { return null; }
  }
  return {...ref, id};
}

// Both the displayed report and its copy use the same claim-to-source assignments.
// A bibliography by itself cannot identify which passage supports a clinical claim.
export function clinicalSections(answer = {}) {
  const groups = Object.fromEntries(Object.entries(sectionTitles).map(([key, title]) => [key, {key, title, blocks: [], notes: []}]));
  const records = new Map((answer.citations || []).map(identifiedSource).filter(Boolean).map(s => [s.id, s]));
  const seen = new Set();
  let incomplete = false;
  const blocks = [...(answer.blocks || [])];
  if (answer.diagnosisNotice) {
    if (answer.diagnosisReferences?.length) blocks.unshift({text: answer.diagnosisNotice, references: answer.diagnosisReferences, section: 'synthesis'});
    else groups.synthesis.notes.push('An individual diagnosis cannot be established from this chat.');
  }
  if (answer.careAdvice?.text) blocks.push({...answer.careAdvice, kind: 'care-advice', section: 'limitations'});
  for (const block of blocks) {
    if (typeof block?.text !== 'string' || !block.text.trim() || block.kind === 'follow-up' || block.kind === 'diagnosis-lead') continue;
    const refs = block.references?.length ? block.references : block.citation ? [block.citation] : (block.sourceIds || []).map(id => records.get(id));
    const cleanRefs = refs.map(identifiedSource);
    if (!cleanRefs.length || cleanRefs.some(ref => !ref)) { incomplete = true; continue; }
    const references = [...new Map(cleanRefs.map(ref => [ref.id, ref])).values()];
    const text = block.text.trim();
    if (seen.has(text)) continue;
    seen.add(text);
    const key = Object.hasOwn(sectionTitles, block.section) ? block.section
      : block.kind === 'care-advice' ? 'limitations' : groups.synthesis.blocks.length ? 'evidence' : 'synthesis';
    groups[key].blocks.push({...block, text, references, citation: references[0]});
  }
  if (!groups.synthesis.blocks.length) groups.synthesis.notes.push('The retrieved passages do not establish a direct answer to this question.');
  if (!groups.evidence.blocks.length) groups.evidence.notes.push(groups.synthesis.blocks.length ? 'No additional source-supported detail was available beyond the synthesis.' : 'No additional claim could be linked to an identified source.');
  for (const gap of answer.gaps || []) {
    if (typeof gap === 'string' && gap.trim() && !groups.limitations.notes.includes(gap.trim())) groups.limitations.notes.push(gap.trim());
  }
  if (incomplete) groups.limitations.notes.push('Some statements were withheld because their supporting passages could not be identified.');
  if (!groups.limitations.blocks.length) groups.limitations.notes.push('This answer has no source-supported assessment of contraindications for this question.');
  return Object.values(groups);
}
