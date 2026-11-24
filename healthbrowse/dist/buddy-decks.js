import {definitionExcerpt} from './answer-relevance.js';
import {renderAnswer} from './answer-view.js';
import {domainTitle} from './disease-framework.js';
import {buddyLearningQuestions} from './learning-questions.js';
import {domainAnswer} from './search-experience.js';

// A local disease answer uses the same verified passage and audience ranking
// as the individual domain. Carry the original source wording into its citation.
function localDiseaseBlocks(context, deck) {
  const answer = domainAnswer(context, deck, {detail: false});
  return answer.blocks.filter(block => !block.check?.provenance?.historical).map((block, index) => {
    const source = block.citation;
    const passage = context.passages.find(p =>
      (p.sourceRecord || p.url) === source.url &&
      (p.text === block.text || (p.focus + ' — ' + p.text) === block.text)
    );
    const ref = {...source, id: source.id || 'D' + deck + '.' + (index + 1)};
    if (!ref.quote && passage) ref.quote = passage.text;
    return {text: block.text, references: [ref]};
  });
}

function localDefinition(context) {
  for (const block of context.directAnswer?.blocks || []) {
    const references = block.references || (block.citation ? [block.citation] : []);
    if (!references.length) continue;
    const text = definitionExcerpt(block, 'What is ' + context.topic + '?', context.topic);
    if (text) return [{text, references}];
  }
  return [];
}

export function localBuddyDecks(context = {}) {
  const titles = context.learningMode
    ? buddyLearningQuestions(context.role)
    : Array.from({length: 6}, (_, i) => domainTitle(i + 1, context.role));
  return titles.map((title, index) => {
    const deck = index + 1;
    let blocks = [];
    if (context.learningMode) {
      // Browser summaries have no educational domain annotations. Only a
      // definition explicitly about this topic can be assigned locally.
      if (deck === 1 && context.topic) blocks = localDefinition(context);
    } else if (context.topic && context.passages?.length) {
      blocks = localDiseaseBlocks(context, deck);
    }
    return {deck, title, blocks};
  });
}

function citedBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).flatMap(block => {
    if (typeof block?.text !== 'string' || !block.text.trim() || !Array.isArray(block.references)) return [];
    const references = block.references.filter(ref => {
      try {
        const url = new URL(ref.url);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    });
    return references.length ? [{...block, references}] : [];
  });
}

// Never transfer a disease excerpt into a learning deck that happens to share its number.
export function mergeBuddyDecks(incoming, previous) {
  if (!incoming?.length) return previous;
  return incoming.map((deck, index) => {
    const old = previous?.[index];
    if (old?.deck === deck.deck && old.title === deck.title && !citedBlocks(deck.blocks).length && citedBlocks(old.blocks).length) return old;
    return deck;
  });
}

export function renderBuddyDecks(parent, decks, renderCheck, pending = false) {
  if (!Array.isArray(decks) || decks.length !== 6) return;
  const group = document.createElement('section');
  group.className = 'buddy-decks';
  const heading = document.createElement('h3');
  const covered = decks.filter(deck => citedBlocks(deck.blocks).length);
  heading.textContent = covered.length ? 'Six decks · ' + covered.length + ' with sources' : 'Six decks';
  group.append(heading);

  for (const deck of decks) {
    const detail = document.createElement('details');
    detail.className = 'buddy-deck';
    detail.open = deck.deck === (covered[0]?.deck ?? 1);
    const summary = document.createElement('summary');
    const number = document.createElement('span');
    number.className = 'buddy-deck-number';
    number.textContent = 'Deck ' + deck.deck;
    const title = document.createElement('span');
    title.textContent = deck.title;
    summary.append(number, title);
    const content = document.createElement('div');
    content.className = 'buddy-deck-content';
    const blocks = citedBlocks(deck.blocks);
    if (blocks.length) {
      renderAnswer(content, {blocks}, renderCheck);
    } else {
      const gap = document.createElement('p');
      gap.className = 'buddy-deck-gap';
      gap.textContent = pending ? 'Looking for a supporting passage…' : 'No supporting passage was found for this deck.';
      content.append(gap);
    }
    detail.append(summary, content);
    group.append(detail);
  }
  parent.append(group);
}
