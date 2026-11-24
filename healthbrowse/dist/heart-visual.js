// These intents describe normal adult anatomy. Unrecognized qualifiers keep the
// original question on the ordinary evidence path (e.g. a fetal or diseased heart).
const broadHeart = /^(?:(?:the|human|adult) )*heart$/;
const vocabulary = new Set(('a an the what which how does do is are of in through from to and its ' +
  'show me please explain describe name label identify diagram draw illustrate trace outline route ' +
  'path pathway direction sequence circulation circulates travel travels move moves flow flows flowing ' +
  'pump pumps pumping pumped blood heart cardiac human adult normal work works function functions go goes ' +
  'four 4 main parts structures structure anatomy anatomical chamber chambers atria atrium ventricles ' +
  'ventricle valve valves right left upper lower locations located where sit their between body lungs ' +
  'common conditions').split(/\s+/));

export function heartIntent(question) {
  const q = String(question ?? '').normalize('NFKC').toLowerCase().trim()
    .replace(/[?!.]+$/, '').replace(/[-\s]+/g, ' ').trim();
  if (broadHeart.test(q)) return 'clarify';
  if (!/\b(?:heart|cardiac)\b/.test(q) || q.split(' ').some(w => !vocabulary.has(w))) return null;
  if (/^(?:what are (?:the )?)?common heart conditions$/.test(q)) return 'conditions';
  if (/\bconditions\b/.test(q)) return null;
  if (/\bvalves?\b/.test(q)) return 'valves';
  if (/\b(?:flow\w*|pump\w*|circulat\w*|travel\w*|route|path(?:way)?|function\w*|works?)\b/.test(q)) return 'flow';
  if (/\b(?:chambers?|parts|anatom\w*|structur\w*|atrium|atria|ventricles?)\b/.test(q) ||
      /^(?:what is|describe|diagram|draw|illustrate|show me) (?:a |an |the )?(?:human |adult )?heart$/.test(q)) return 'chambers';
  return null;
}

export const heartFigures = {
  chambers: 'm46676-fig-ch20_01_08',
  valves: 'm46676-fig-ch20_01_11'
};
export const heartParagraphs = {
  flow: ['fs-id2175356', 'fs-id1236860', 'fs-id1478856', 'fs-id1435292'],
  chambers: ['fs-id1478856'],
  valves: ['fs-id2718087', 'fs-id2795451', 'fs-id2326948', 'fs-id2743769']
};
const revision = 'b0058a743bdd2cc08196abaaa7d5469970c0d80c';
const sourceUrl = 'https://github.com/openstax/osbooks-anatomy-physiology/blob/' + revision + '/modules/m46676/index.cnxml';

export function heartSourceRank(intent, ref) {
  if (ref?.url !== sourceUrl || ref.sourceRevision !== revision) return -1;
  return heartParagraphs[intent]?.indexOf(ref.sourceParagraph) ?? -1;
}

// Each row stands on its own. A missing passage can never connect two
// non-adjacent structures. Match the relevant wording as well as its provenance.
const circulation = [
  ['Body', 'Right atrium', 'Systemic veins', 'Right atrium', 'fs-id2175356', 'vena cava, which return blood to the right atrium'],
  ['Right atrium', 'Right ventricle', 'Right atrium', 'Right ventricle', 'fs-id2175356', 'right atrium, which pumps blood into the right ventricle'],
  ['Right ventricle', 'Lungs', 'Right ventricle', 'Pulmonary capillaries', 'fs-id1236860', 'right ventricle pumps deoxygenated blood into the pulmonary trunk', 'before reaching the pulmonary capillaries'],
  ['Lungs', 'Left atrium', 'Pulmonary veins', 'Left atrium', 'fs-id1236860', 'blood returning from the pulmonary capillaries in the lungs', 'pulmonary veins conduct blood into the left atrium'],
  ['Left atrium', 'Left ventricle', 'Left atrium', 'Left ventricle', 'fs-id1236860', 'left atrium, which pumps the blood into the left ventricle'],
  ['Left ventricle', 'Body', 'Left ventricle', 'Systemic arteries', 'fs-id1236860', 'left ventricle, which in turn pumps oxygenated blood into the aorta and on to the many branches of the systemic circuit']
];

export function citedHeartFlow(references, clinical) {
  const rows = [];
  for (const [from, to, clinicalFrom, clinicalTo, paragraph, ...anchors] of circulation) {
    const ref = references.find(r => heartSourceRank('flow', r) >= 0 && r.sourceParagraph === paragraph &&
      anchors.every(a => String(r.text || '').toLowerCase().includes(a)));
    if (ref) rows.push({from: clinical ? clinicalFrom : from, to: clinical ? clinicalTo : to, ref});
  }
  return rows;
}
