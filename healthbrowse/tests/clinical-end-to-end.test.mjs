import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clinicalSections} from '../dist/clinical-sections.js';
import {requestSynthesis} from '../dist/model-client.js';
import {modelAPI} from '../server/model-api.mjs';
import {GROQ_CHAT_URL} from '../server/model-provider.mjs';
import {openWorkspace} from '../server/sqlite-workspace.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const assets = Object.fromEntries(['medline-topics', 'clinical-passages', 'grounded-sources'].map(name =>
  ['/' + name + '.json', {text: read('../dist/' + name + '.json')}]));
const question = 'What is the main function of the pituitary gland?';
const unsupported = 'The study reported a result of exactly 73 percent.';
const invented = 'The source describes a previously unreported mechanism.';

test('clinical search and Buddy deliver only reviewed claims with verbatim spans and keep General answers in their own format', async t => {
  const DB = openWorkspace(':memory:');
  t.after(() => DB.close());
  for (const entry of JSON.parse(read('../drizzle/meta/_journal.json')).entries)
    DB.exec(read('../drizzle/' + entry.tag + '.sql'));
  const env = {DB, RETRIEVAL_LIVE:'off', SUPABASE_URL:'https://auth.example', SUPABASE_ANON_KEY:'fixture-public', MODEL_PROVIDER:'groq', GROQ_API_KEY:'fixture'};
  const fetched = new Map();
  let clinical = false;
  let generated = 0;
  let reviewed = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://auth.example/auth/v1/user')
      return Response.json({id:'11111111-1111-4111-8111-111111111111'});
    assert.equal(url, GROQ_CHAT_URL);
    const payload = JSON.parse(options.body);
    const input = JSON.parse(payload.messages[1].content);
    let output;
    if (input.claims) {
      reviewed++;
      output = {checks: input.claims.map(claim => ({
        id:claim.id, verdict:'supported', sources:claim.sources,
        ...(clinical ? {quotes:[claim.text === unsupported ? fetched.get(claim.sources[0]) : claim.text]} : {})
      }))};
    } else {
      generated++;
      fetched.clear();
      for (const s of input.evidence) fetched.set(s.id, s.text);
      const source = input.evidence.find(s => s.text.includes('hormones that affect growth'));
      assert.ok(source, 'the test must reach the genuine topic retrieval path');
      const [anatomy, functionOfGland] = source.text.match(/[^.]+\./g).map(s => s.trim());
      const claim = (text, section) => ({text, sources:[source.id], ...(clinical ? {section} : {})});
      output = {answer:[claim(functionOfGland, 'synthesis'), claim(anatomy, 'evidence')]};
      if (clinical) output.answer.push(claim(unsupported, 'limitations'), claim(invented, 'evidence'));
      assert.deepEqual(Object.keys(payload.response_format.json_schema.schema.properties), ['answer']);
    }
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
  });

  const fetcher = (path, init) => modelAPI(new Request('https://desk.example' + path, init), env, assets);
  for (const role of ['Clinicians','General']) {
    clinical = role === 'Clinicians';
    for (const mode of ['search','chat']) {
      const result = await requestSynthesis({topic:'Pituitary gland', role, query:question}, question, {
        mode, deck:mode === 'chat' ? 2 : 0, fetcher, tokenProvider:async () => 'fixture-session-123'
      });
      assert.equal(result.status, 'generated');
      assert.deepEqual(result.decks, []);
      assert.equal(Boolean(result.answer.clinicalSynthesis), clinical);
      assert.equal(result.answer.blocks.length, 2);
      if (clinical) {
        assert.deepEqual(result.answer.blocks.map(b => b.section), ['synthesis','evidence']);
        assert.ok(result.validation.withheldClaims >= 2);
        const sections = clinicalSections(result.answer);
        assert.deepEqual(sections.map(s => s.title), ['Clinical Synthesis','Evidence Breakdown','Limitations & Contraindications']);
        assert.equal(sections[2].blocks.length, 0);
        assert.ok(sections[2].notes.length > 0, 'explain the missing limitations evidence');
      } else {
        assert.ok(result.answer.blocks.every(b => b.section === undefined));
      }
      for (const block of result.answer.blocks) {
        assert.equal(block.references.length, 1);
        const ref = block.references[0];
        assert.ok(fetched.get(ref.id)?.includes(ref.quote));
        if (clinical) assert.equal(ref.quote, block.text, 'preserve the verified span, not the full passage');
        assert.ok(result.answer.text.includes('[' + ref.id + ']'));
      }
      assert.ok(!result.answer.text.includes(unsupported));
      assert.ok(!result.answer.text.includes(invented));
    }
  }
  assert.equal(generated, 4);
  assert.equal(reviewed, 4);
});
