import test from 'node:test';
import assert from 'node:assert/strict';
import {healthQuestions, buddyHealthTask, buddyHealthGuide} from '../dist/health-questions.js';
import {classifyResponseMode, screenGeneralQuery} from '../dist/response-mode.js';
import {clarifyQuery} from '../dist/query-understanding.js';

test('the ten general-reader questions reach medical search, Buddy or the urgent response', () => {
  const routes = healthQuestions.map(question => {
    const {status} = screenGeneralQuery(question);
    return status === 'ok' ? buddyHealthTask(question) || classifyResponseMode(question) : status;
  });
  assert.deepEqual(routes, ['medical','lab','imaging','medical','medical','medical','emergency','medical','medical','visit']);
});

test('written report handoff is specific to the user’s file and acute symptom requests still trigger safety checks', () => {
  for (const q of ['What is a CT scan?', 'What does a normal lab report show?', 'What is a doctor’s appointment?']) {
    assert.equal(buddyHealthTask(q), null);
  }
  assert.equal(buddyHealthTask('Can you explain my blood test results?'), 'lab');
  assert.equal(buddyHealthTask('Please explain the attached MRI report.'), 'imaging');
  assert.equal(screenGeneralQuery('I have chest pain right now. Can you review my scan?').status, 'emergency');
  assert.equal(screenGeneralQuery('I have a sudden severe headache right now').status, 'emergency');
  assert.equal(screenGeneralQuery('Can you diagnose my severe headache right now?').status, 'emergency');
  assert.equal(screenGeneralQuery('What can cause a sudden headache?').status, 'ok');
  assert.match(buddyHealthGuide('imaging').text, /written radiology report/);
  assert.ok(buddyHealthGuide('visit').blocks.every(block => block.references[0].url.startsWith('https://www.nia.nih.gov/')));
});

test('medicine placeholders prompt for a name while named medicines continue to search', () => {
  assert.match(clarifyQuery('What are common side effects and precautions for [medication name]?').title,/Which medicine/);
  assert.equal(clarifyQuery('What are common side effects of ibuprofen?'), null);
});
