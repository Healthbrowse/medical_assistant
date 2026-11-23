import {isCuratedBrowserVisual} from './browser-curated-images.js';

const el = (tag, text = '', className = '') =>
  Object.assign(document.createElement(tag), {textContent: text, className});

function link(text, href) {
  return Object.assign(el('a', text), {href, target: '_blank', rel: 'noopener noreferrer'});
}

function imageRights(visual) {
  if (!visual?.title || !visual.alt || !visual.attribution || !visual.sourceUrl) return null;
  if (isCuratedBrowserVisual(visual)) return [visual.license, visual.licenseUrl];
  if (/^\/api\/education-image\?id=m\d+-[A-Za-z0-9_-]+$/.test(visual.src) &&
      /^https:\/\/github\.com\/openstax\/osbooks-anatomy-physiology\/blob\/[a-f0-9]{40}\/modules\//.test(visual.sourceUrl))
    return ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'];
  if (visual.src === '/api/education-image?id=nhgri-mitochondria' &&
      visual.sourceUrl === 'https://www.genome.gov/genetics-glossary/Mitochondria')
    return ['NHGRI image policy', 'https://www.genome.gov/about-nhgri/Policies-Guidance/Copyright'];
  if (/^\/api\/browser\/public-figure\?id=(?:commons-)?[1-9]\d{0,9}&asset=1$/.test(visual.src) &&
      visual.sourceUrl.startsWith('https://commons.wikimedia.org/wiki/File:') &&
      /^https:\/\/creativecommons\.org\/(?:licenses|publicdomain)\//.test(visual.licenseUrl) && visual.license)
    return [visual.license, visual.licenseUrl];
  if (visual.src === '/api/browser/public-figure?id=usgs-water-cycle&asset=1' &&
      visual.sourceUrl === 'https://www.usgs.gov/media/images/water-cycle-diagram-diagram-only')
    return ['Public domain', visual.sourceUrl];
  return null;
}

export function renderEducationalVisual(parent, visual, onFailure) {
  const rights = imageRights(visual);
  if (!rights) return false;
  const figure = el('figure', '', 'education-visual');
  const heading = el('div', '', 'education-visual-heading');
  heading.append(el('h4', visual.title));
  const fullSize = link('Open image', visual.src);
  const image = el('img');
  image.alt = visual.alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.width = Number.isInteger(visual.width) && visual.width > 0 ? visual.width : 600;
  image.height = Number.isInteger(visual.height) && visual.height > 0 ? visual.height : 400;
  const caption = el('figcaption');
  caption.append(el('p', visual.caption || visual.alt, 'education-visual-caption'));
  if (visual.context) caption.append(el('p', visual.context, 'education-visual-context'));
  const credit = el('p', '', 'image-credit');
  credit.append(el('strong', 'Image credit '), document.createTextNode(visual.attribution));
  const links = el('div', '', 'education-visual-links');
  links.append(link('Original source', visual.sourceUrl), link(rights[0], rights[1]), fullSize);
  caption.append(credit, links);
  image.addEventListener('error', () => {
    image.hidden = true;
    fullSize.remove();
    heading.after(el('p', 'Image unavailable. The original source is linked below.', 'education-visual-context'));
    onFailure?.();
  }, {once: true});
  figure.append(heading, image, caption);
  parent.append(figure);
  image.src = visual.src;
  return true;
}
