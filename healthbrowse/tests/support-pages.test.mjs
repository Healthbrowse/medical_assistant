import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupSupportForms} from '../dist/support-forms.js';

function page(name) {
  return readFileSync(new URL('../dist/' + name + '.html', import.meta.url), 'utf8');
}

const pages = {
  feedback: {message: 'Please show the publication date.', category: 'feature'},
  contact: {message: 'I have a question about the project.', name: 'Reviewer', email: 'reviewer@example.test'}
};

test('both Help menus link directly to the separate support forms', () => {
  for (const name of ['index', 'account']) {
    const header = page(name).match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0] || '';
    for (const kind of Object.keys(pages)) {
      assert.ok(header.includes('href="/' + kind + '.html"'), name + ' needs a link to ' + kind);
    }
  }
});

for (const [kind, data] of Object.entries(pages)) {
  test(kind + ' opens with one form and posts only that form’s fields', async t => {
    const html = page(kind);
    const forms = html.match(/<form\b[^>]*>/gi) || [];
    assert.equal(forms.length, 1);
    assert.ok(forms[0].includes('id="' + kind + 'Form"'));

    const controls = new Map();
    const button = {};
    const form = {
      reportValidity: () => true,
      querySelector: () => button,
      setAttribute() {},
      removeAttribute() {}
    };
    controls.set(kind + 'Form', form);
    controls.set(kind + 'Status', {classList: {remove() {}, add() {}}});
    for (const [field, value] of Object.entries(data)) {
      const id = kind + field[0].toUpperCase() + field.slice(1);
      assert.ok(html.includes('id="' + id + '"'), 'Missing control ' + id);
      controls.set(id, Object.assign(new EventTarget(), {value}));
    }

    const previousDocument = globalThis.document;
    globalThis.document = {getElementById: id => controls.get(id) ?? null};
    t.after(() => {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    });
    const calls = [];
    setupSupportForms({
      isSignedIn: () => true,
      request: async (url, options) => {
        calls.push({url, ...options});
        return {requestId: options.body.requestId, status: 'received'};
      }
    });
    await form.onsubmit(new Event('submit', {cancelable: true}));

    assert.equal(calls.length, 1);
    const [{url, method, body}] = calls;
    assert.equal(url, '/api/' + kind);
    assert.equal(method, 'POST');
    const {requestId, ...submitted} = body;
    assert.ok(requestId);
    assert.deepEqual(submitted, data);
    assert.equal(controls.get(kind + 'Message').value, '');
    assert.ok(controls.get(kind + 'Status').textContent.includes(requestId));
  });
}
