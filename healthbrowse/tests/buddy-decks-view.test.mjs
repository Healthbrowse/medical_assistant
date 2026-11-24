import test from 'node:test';
import assert from 'node:assert/strict';
import {localBuddyDecks, mergeBuddyDecks, renderBuddyDecks} from '../dist/buddy-decks.js';

const topic = 'Leukemia';
const citation = {title: topic, url: 'https://medlineplus.gov/leukemia.html'};
const excerpt = {deck: 3, text: 'Example symptom passage.', record: 'fixture-3', focus: topic, ...citation};

test('local reports keep the six role-specific topics and quote only matched passages', () => {
  for (const role of ['General reader', 'Medical professional']) {
    const decks = localBuddyDecks({topic, role, passages: [
      excerpt,
      {...excerpt, record: 'other-topic', deck: 4, focus: 'Asthma'},
      {...excerpt, record: 'other-source', deck: 5, url: 'https://example.test/article'}
    ]});
    assert.deepEqual(decks.map(d => d.deck), [1, 2, 3, 4, 5, 6]);
    assert.match(decks[2].title, role === 'General reader' ? /symptoms/ : /Clinical Manifestations/);
    assert.deepEqual(decks.map(d => d.blocks.length), [0, 0, 1, 0, 0, 0]);
    assert.equal(decks[2].blocks[0].references[0].quote, excerpt.text);
    assert.equal(decks[2].blocks[0].references[0].url, citation.url);
  }
});

test('educational fallback can show a matching definition without reusing disease passages in its other decks', () => {
  const context = {
    topic: 'Mitochondria', role: 'Clinicians', learningMode: true, passages: [excerpt],
    directAnswer: {blocks: [{text: 'Mitochondria are cellular structures.', references: [{id: 'S1', url: 'https://www.genome.gov/genetics-glossary/Mitochondria'}]}]}
  };
  const decks = localBuddyDecks(context);
  assert.equal(decks[1].title, 'Physiology and mechanisms');
  assert.deepEqual(decks.map(d => d.blocks.length), [1, 0, 0, 0, 0, 0]);
  assert.equal(localBuddyDecks({...context, topic: 'Pituitary gland'})[0].blocks.length, 0);
});

test('chat renders six accessible disclosures with citations and explicit gaps', t => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    addEventListener() {}
    setAttribute(attr, value) { this.attributes[attr] = value; }
    descendants(tag) {
      return this.children.flatMap(el => [...(el.tag === tag ? [el] : []), ...el.descendants(tag)]);
    }
  }
  const previous = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag)};
  t.after(() => { if (previous) globalThis.document = previous; else delete globalThis.document; });
  const root = new Element('div');
  const decks = localBuddyDecks({topic, role: 'General reader', passages: [excerpt]});
  decks[4].blocks.push({text:'  ',references:[citation]}, {text:'Unlinked assertion.', references:[]});
  renderBuddyDecks(root, decks);
  const [group] = root.children;
  assert.equal(group.children[0].textContent, 'Six decks · 1 with sources');
  const details = group.children.slice(1);
  assert.deepEqual(details.map(d => d.tag), Array(6).fill('details'));
  assert.deepEqual(details.map(d => d.open), [false, false, true, false, false, false]);
  assert.ok(details.every(d => d.children[0].tag === 'summary'));
  assert.equal(details[2].descendants('blockquote')[0].textContent, excerpt.text);
  assert.equal(details[2].descendants('a')[0].href, citation.url);
  assert.match(details[4].descendants('p')[0].textContent, /No supporting passage/);
});

test('an empty enrichment preserves cited sections only in the same deck framework', () => {
  const context = {topic, role:'General reader', passages:[excerpt]};
  const previous = localBuddyDecks(context);
  const incoming = localBuddyDecks({...context, passages:[]});
  incoming[1].blocks = [{text:'New supported content', references:[citation]}];
  incoming[2].blocks = [{text:'Unlinked claim', references:[]}];
  const merged = mergeBuddyDecks(incoming, previous);
  assert.equal(merged[2], previous[2]);
  assert.equal(merged[1], incoming[1]);
  const learning = localBuddyDecks({...context,learningMode:true});
  assert.equal(mergeBuddyDecks(learning,previous)[2].blocks.length, 0);
  assert.deepEqual(mergeBuddyDecks([], previous), previous);
});
