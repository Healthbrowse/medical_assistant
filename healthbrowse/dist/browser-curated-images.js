// Each local file is an unmodified copy of the image identified by its source record.
const leukemia = {
  id: 'nci-leukemia-cells',
  src: '/nci-leukemia-cells.jpg',
  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/Blood_cells_%28normal_and_leukemia%29.jpg',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Blood_cells_(normal_and_leukemia).jpg',
  title: 'Blood cells in leukemia',
  alt: 'Side-by-side drawings label normal blood components on the left and immature cells called blasts on the right.',
  caption: 'Compare the labeled cells in these two blood samples. The drawing on the right highlights blast cells.',
  attribution: 'Alan Hoofring, National Cancer Institute · NCI Visuals Online, image 4345',
  license: 'Public domain',
  licenseUrl: 'https://commons.wikimedia.org/wiki/File:Blood_cells_(normal_and_leukemia).jpg#Licensing',
  width: 1050,
  height: 1001
};

const acuteMyeloidLeukemia = {
  id: 'cdc-aml-bone-marrow',
  src: '/cdc-aml-bone-marrow.jpg',
  imageUrl: 'https://wwwn.cdc.gov/phil/PHIL_Images/19468/19468_lores.jpg',
  sourceUrl: 'https://wwwn.cdc.gov/PHIL/Details.aspx?pid=19468',
  title: 'Acute myeloid leukemia under the microscope',
  alt: 'Microscope photograph of a stained bone marrow sample with numerous purple immature white blood cells.',
  caption: 'This example shows one subtype, acute myeloid leukemia. The bone marrow sample contains many immature white blood cells.',
  attribution: 'CDC Public Health Image Library · Carl Flint and Dr. Volger, Emory University Hospital · PHIL 19468',
  license: 'Public domain',
  licenseUrl: 'https://wwwn.cdc.gov/PHIL/Details.aspx?pid=19468',
  width: 700,
  height: 460
};

const mitochondria = {
  id: 'nhgri-mitochondria',
  src: '/nhgri-mitochondria.jpg',
  imageUrl: 'https://www.genome.gov/sites/default/files/media/images/2021-11/mitochondria_0.jpg',
  sourceUrl: 'https://www.genome.gov/genetics-glossary/Mitochondria',
  title: 'Inside a mitochondrion',
  alt: 'Cutaway diagram labeling the outer membrane, inner membrane and cristae of a mitochondrion.',
  caption: 'The folds of the inner membrane are called cristae.',
  attribution: 'Courtesy of the National Human Genome Research Institute',
  license: 'Public domain · NHGRI image policy',
  licenseUrl: 'https://www.genome.gov/about-nhgri/Policies-Guidance/Copyright',
  width: 1600,
  height: 891
};

const byTopic = new Map([
  ['leukemia', leukemia],
  ['leukaemia', leukemia],
  ['acute myeloid leukemia', acuteMyeloidLeukemia],
  ['acute myelogenous leukemia', acuteMyeloidLeukemia],
  ['acute myeloid leukaemia', acuteMyeloidLeukemia],
  ['acute myelogenous leukaemia', acuteMyeloidLeukemia],
  ['mitochondria', mitochondria],
  ['mitochondrion', mitochondria]
]);

export function curatedBrowserVisual(topic) {
  const normalized = String(topic || '').trim().toLowerCase().replace(/\s+\(aml\)$/, '');
  return byTopic.get(normalized) || null;
}

export function curatedBrowserVisuals(topic) {
  const primary = curatedBrowserVisual(topic);
  if (primary === leukemia) return [primary, acuteMyeloidLeukemia];
  return primary ? [primary] : [];
}

export function isCuratedBrowserVisual(visual) {
  return !!visual && [leukemia, acuteMyeloidLeukemia, mitochondria].some(known =>
    visual.src === known.src && visual.sourceUrl === known.sourceUrl &&
    visual.attribution === known.attribution && visual.licenseUrl === known.licenseUrl &&
    visual.license === known.license
  );
}
