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

export function renderBloodFlow(parent, rows) {
  if (!rows.length) return false;
  const title = 'Direction of blood flow';
  const figure = document.createElement('figure');
  figure.className = 'answer-graphic cited-diagram';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const svg = svgElement('svg', {role: 'img', viewBox: '0 0 430 ' + (rows.length * 52)});
  svg.append(svgElement('title', {}, title), svgElement('desc', {},
    rows.map(r => r.from + ' to ' + r.to + '.').join(' ')));
  const citations = new Map();
  for (const [i, {from, to, ref}] of rows.entries()) {
    if (!citations.has(ref.sourceParagraph)) citations.set(ref.sourceParagraph, ref);
    const number = [...citations.keys()].indexOf(ref.sourceParagraph) + 1;
    const y = i * 52 + 2;
    for (const [x, name] of [[2, from], [222, to]]) {
      svg.append(svgElement('rect', {x, y, width: 180, height: 42, rx: 8, class: 'diagram-card'}),
        svgElement('text', {x: x + 90, y: y + 26, 'text-anchor': 'middle'}, name));
    }
    const mid = y + 21;
    svg.append(svgElement('path', {d: 'M187 ' + mid + 'h29m-8 -6 8 6 -8 6', class: 'diagram-branch'}),
      svgElement('text', {x: 407, y: mid + 4, class: 'diagram-ref'}, '[' + number + ']'));
  }
  const caption = document.createElement('figcaption');
  caption.textContent = 'Each arrow summarizes one part of normal circulation from the cited passage.';
  const list = document.createElement('ol');
  list.className = 'diagram-sources';
  for (const [i, ref] of [...citations.values()].entries()) {
    const item = document.createElement('li');
    const source = document.createElement('a');
    Object.assign(source, {href: ref.url, target: '_blank', rel: 'noopener noreferrer',
      textContent: '[' + (i + 1) + '] OpenStax · ' + ref.sourceParagraph});
    item.append(source);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Read the passage';
    const quote = document.createElement('blockquote');
    quote.textContent = ref.text;
    details.append(summary, quote);
    item.append(details);
    list.append(item);
  }
  caption.append(list);
  const credit = document.createElement('a');
  Object.assign(credit, {href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank',
    rel: 'noopener noreferrer', textContent: 'Adapted from OpenStax Anatomy and Physiology 2e · CC BY 4.0'});
  caption.append(credit);
  figure.append(heading, svg, caption);
  parent.append(figure);
  return true;
}
