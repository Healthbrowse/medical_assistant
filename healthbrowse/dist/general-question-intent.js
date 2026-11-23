// General-audience wording observed in the ChatDoctor question preview. Only
// intent labels are returned. Medical evidence comes from the retrieval pipeline.
const family = /\b(?:my|our) (?:baby|child(?:ren)?|toddler|teenager|son|daughter|mother|father|mom|mum|dad|parent|partner|husband|wife|grandmother|grandfather|brother|sister)\b|\b(?:a|the) (?:caregiver|carer)\b/;
const causes = /\b(?:what (?:it could (?:possibly )?be|causes?|caused|could (?:this |it )?(?:possibly )?be|might (?:this |it )?be|(?:might|could|can|would) (?:cause|explain|be causing))|(?:possible|common|likely) causes?|why (?:am i|do i|does (?:my|our)|is (?:my|our))|could (?:it|this|that) be)\b/;
const next = /\b(?:what (?:should|can|do) (?:i|we) do|what to do|what (?:are )?(?:the |my |our )?next steps?|when (?:should|do) (?:i|we)|(?:should|do) (?:i|we) (?:need|seek|call|see|visit|go|take|bring|worry)|when to (?:seek|call|see)|(?:need|needs) (?:urgent care|medical help))\b/;

export function generalQuestionIntent(text) {
  const words = String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return {caregiver: family.test(words), possibleCauses: causes.test(words), nextSteps: next.test(words)};
}
