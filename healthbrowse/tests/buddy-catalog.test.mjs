import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('the deck worker reads public catalogs once and returns role-specific cited medical passages', async t => {
  const paths = [];
  let result;
  globalThis.self = {postMessage: message => { result = message; }};
  t.after(() => { delete globalThis.self; });
  t.mock.method(globalThis,'fetch',async (path, options) => {
    assert.equal(options.credentials,'omit');
    assert.match(path,/^\/[a-z-]+\.json$/);
    paths.push(path);
    return new Response(await readFile(new URL('../dist'+path,import.meta.url)));
  });
  await import('../client/buddy-deck-worker.mjs');
  for (const role of ['General reader','Medical professional']) {
    for (const [topic, learning, full] of [['Type 2 diabetes',false,true],['Leukemia',false,true],['Pituitary gland',true,false]]) {
      await self.onmessage({data:{id:1,role,topic}});
      assert.equal(result.report.learningMode,learning);
      const decks = result.report.decks;
      assert.equal(decks.length,6);
      if (full) assert.ok(decks.every(deck => deck.blocks.length),topic);
      assert.ok(decks.some(deck => deck.blocks.length),topic);
      if (topic==='Pituitary gland') assert.ok(decks.some(deck => !deck.blocks.length));
      for (const {blocks} of decks) for (const block of blocks) {
        assert.ok(block.references.some(ref => ref.quote===block.text && ref.url.startsWith('https://')));
      }
      if (topic==='Leukemia') assert.match(decks[2].title,role==='Medical professional' ? /Clinical Manifestations/ : /symptoms/);
    }
  }
  assert.equal(paths.length,4);
  assert.equal(new Set(paths).size,4);
});
