import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSynthesis} from '../dist/model-client.js';

const direct = {text: 'Reviewed answer', blocks: [], citations: []};
const ref = {id: 'S1', quote: 'Sample reviewed passage.', title: 'Example source', url: 'https://example.org/evidence'};

for (const role of ['General reader', 'Medical professional']) {
  test('the ' + role + ' overview keeps all six cited or empty decks only in Buddy', async () => {
    const decks = Array.from({length: 6}, (_, index) => ({
      deck: index + 1,
      title: 'Section ' + (index + 1),
      blocks: index === 5 ? [] : [{text: ref.quote, references: [ref]}]
    }));
    const context = {role, topic: 'Dengue', query: 'What is dengue?'};
    const calls = [];
    const fetcher = async (url, options) => {
      if (url.endsWith('/status')) return Response.json({});
      const request = JSON.parse(options.body);
      calls.push([request.mode, request.deck, request.role]);
      return Response.json({status: 'sourced', answer: direct, decks});
    };
    for (const [mode, deck] of [['chat', 0], ['chat', 3], ['search', 0]]) {
      const result = await requestSynthesis(context, context.query, {
        mode, deck, fetcher, tokenProvider: async () => 'test-only'
      });
      assert.deepEqual(result.answer, direct);
      assert.deepEqual(result.decks, mode === 'chat' && deck === 0 ? decks : []);
    }
    assert.deepEqual(calls, [['chat', 0, role], ['chat', 3, role], ['search', 0, role]]);
  });
}

test('Buddy skips the status request and releases the composer when a response body stalls', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const bodyStarted = Promise.withResolvers();
  const urls = [];
  const pending = requestSynthesis({topic:'Diabetes',role:'General'}, 'What is diabetes?', {
    mode:'chat', tokenProvider:async () => 'fixture',
    fetcher:async url => {
      urls.push(url);
      return {ok:true, json() { bodyStarted.resolve(); return new Promise(() => {}); }};
    }
  });
  await bodyStarted.promise;
  t.mock.timers.tick(35001);
  assert.equal((await pending).status, 'unavailable');
  assert.deepEqual(urls, ['/api/ai/answer']);
});
