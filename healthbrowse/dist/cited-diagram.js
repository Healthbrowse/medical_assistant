// A source diagram groups cited statements. Its branches do not imply a clinical sequence.
const svgNs = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes, text) {
  const element = document.createElementNS(svgNs, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

function linesFor(text, width = 44) {
  const lines = [''];
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  for (const word of words) {
    const parts = word.match(new RegExp('.{1,' + width + '}', 'gu')) || [];
    for (const part of parts) {
      const index = lines.length - 1;
      if (lines[index].length && (lines[index] + ' ' + part).length > width) lines.push(part);
      else lines[index] += (lines[index] ? ' ' : '') + part;
    }
  }
  return lines;
}

function label(svg, lines, x, y, className) {
  const text = svgElement('text', {x, y, class: className});
  lines.forEach((line, i) => text.append(svgElement('tspan', {x, dy: i ? 19 : 0}, line)));
  svg.append(text);
}

export function renderCitedDiagram(parent, topic, items, description = '') {
  if (!items.length) return false;
  const figure = document.createElement('figure');
  figure.className = 'answer-graphic cited-diagram';
  const heading = document.createElement('h4');
  heading.textContent = topic;
  const diagram = svgElement('svg', {role: 'img', preserveAspectRatio: 'xMinYMin meet', width: 418});
  diagram.append(svgElement('title', {}, topic), svgElement('desc', {},
    items.map(({label, detail, ref}) => [label, detail, ref.title || ref.publisher].filter(Boolean).join('. ')).join(' ')));
  let y = 10;
  const sources = new Map();
  const positions = [];
  for (const {label: value, detail, ref} of items) {
    if (!sources.has(ref.url)) sources.set(ref.url, {ref, number: sources.size + 1});
    const lines = linesFor(value, 42);
    const details = detail ? linesFor(detail, 49) : [];
    const rowsHeight = (lines.length + details.length) * 19;
    const height = rowsHeight + (detail ? 28 : 20);
    const middle = y + height / 2;
    positions.push(middle);
    diagram.append(svgElement('path', {d: 'M9 ' + middle + 'H22', class: 'diagram-branch'}));
    diagram.append(svgElement('rect', {x: 22, y, rx: 8, width: 390, height, class: 'diagram-card'}));
    label(diagram, lines, 34, y + 23, detail ? 'diagram-stage' : 'diagram-label');
    if (detail) label(diagram, details, 34, y + 23 + lines.length * 19 + 4, 'diagram-detail');
    label(diagram, ['[' + sources.get(ref.url).number + ']'], 382, y + 23, 'diagram-ref');
    y += height + 10;
  }
  if (positions.length > 1) diagram.append(svgElement('path', {d: 'M9 ' + positions[0] + 'V' + positions.at(-1), class: 'diagram-branch'}));
  diagram.setAttribute('viewBox', '0 0 418 ' + y);
  const caption = document.createElement('figcaption');
  caption.textContent = description || 'HealthBrowse diagram based on the cited answer.';
  const links = document.createElement('ol');
  links.className = 'diagram-sources';
  for (const {ref, number} of sources.values()) {
    const item = document.createElement('li');
    item.append(Object.assign(document.createElement('a'), {href: ref.url, target: '_blank', rel: 'noopener noreferrer',
      textContent: '[' + number + '] ' + (ref.title || ref.publisher || new URL(ref.url).hostname)}));
    links.append(item);
  }
  caption.append(links);
  figure.append(heading, diagram, caption);
  parent.append(figure);
  return true;
}
