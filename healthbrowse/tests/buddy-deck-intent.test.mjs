import assert from 'node:assert/strict';
import test from 'node:test';
import {clarifyQuery, retrievalTerms, usesActiveTopic} from '../dist/query-understanding.js';
import {buddyDeckIntent} from '../dist/buddy-deck-intent.js';

const context = {topic: 'Asthma', responseMode: 'medical'};
test('an explicit six-deck request selects its named subject or retains the active subject', () => {
  for (const [question, topic] of [
    ['Give me all six decks for dengue', 'dengue'],
    ['Explain leukemia in 6 decks', 'leukemia'],
    ['Could you please show a six-deck overview of the pituitary gland?', 'the pituitary gland'],
    ['All six decks for this condition', ''],
    ['Show all six medical decks', ''],
    ['What is bilirubin? Give me all six decks.', 'bilirubin']
  ]) assert.deepEqual(buddyDeckIntent(question, context), {explicit:true, topic, overview:true}, question);
});

test('broad overviews and definitions get six decks, focused and nonmedical questions stay direct', () => {
  for (const question of ['What is dengue?', 'Tell me about bilirubin', 'pituitary gland',
    'Takayasu arteritis', 'What is this condition?', 'Give me an overview of asthma']) {
    assert.equal(buddyDeckIntent(question, context).overview, true, question);
  }
  for (const question of ['What are the symptoms of dengue?', 'How is asthma treated?', 'List studies on asthma',
    'What is the function of the pituitary gland?', 'Give me six SOX decks', 'show all six decks for payroll',
    'Explain procurement', 'Skip the six decks for asthma', 'What is the treatment for asthma?']) {
    assert.equal(buddyDeckIntent(question, context).overview, false, question);
  }
});

test('a section-only follow-up reuses the active disease without swallowing named subjects', () => {
  for (const q of ['What are the common symptoms?', 'What are the symptoms?', 'Which tests are used?',
    'Who is most affected, and what are the risk factors?', 'What is the long-term outlook?']) {
    assert.equal(usesActiveTopic(q), true, q);
    assert.equal(clarifyQuery(q, {topic: 'Leukemia', context: true}), null);
    assert.match(retrievalTerms(q, {topic: 'Leukemia', context: true}), /^leukemia\b/, q);
    assert.equal(buddyDeckIntent(q, {topic: 'Leukemia', responseMode: 'medical'}).overview, false, q);
  }
  for (const q of ['What are the common symptoms of asthma?', 'What are the risk factors for dengue?',
    'Tell me more about diabetes', 'What is the long-term outlook for lupus?']) {
    assert.equal(usesActiveTopic(q), false, q);
  }
});
