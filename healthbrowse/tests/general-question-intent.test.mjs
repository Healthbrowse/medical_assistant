import test from 'node:test';
import assert from 'node:assert/strict';
import {generalQuestionIntent} from '../dist/general-question-intent.js';

test('General questions may express multiple needs in one search', () => {
  assert.deepEqual(generalQuestionIntent('My daughter has a sore throat. What might cause that, and what should we do?'),
    {caregiver: true, possibleCauses: true, nextSteps: true});
  assert.deepEqual(generalQuestionIntent('What could this be?'),
    {caregiver: false, possibleCauses: true, nextSteps: false});
});

test('General knowledge queries do not acquire personal context', () => {
  for (const query of ['How does the pituitary gland work?', 'What is bilirubin?', 'What is a mother cell?', '']) {
    assert.deepEqual(generalQuestionIntent(query), {caregiver: false, possibleCauses: false, nextSteps: false});
  }
});
