import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clinicalClarification, clinicalPreferences, clinicalQuestionForTurn,
  inferClinicalContext, resolveClinicalTurn, validateClinicalContext,
} from '../dist/clinical-interaction.js';
import {modelAPI} from '../server/model-api.mjs';
import {GROQ_CHAT_URL} from '../server/model-provider.mjs';

const caseQuestion = '69M with Child-Pugh B cirrhosis, refractory ascites, and portal vein thrombosis develops an NSTEMI needing a DES. How should we manage antithrombotics and portal hypertension?';
const clinicianInput = {question:caseQuestion, topic:'Clinical case', role:'Medical professional', mode:'chat', deck:0};
const clinicianReply = "I'm a general medicine resident on a medicine ward team. Give me a thorough bedside breakdown, relevant visual/article picks, and include the RLHF feedback block.";
const preferences = {perspective:'general medicine resident', setting:'Inpatient ward', goal:'Management evidence / trade-offs', depth:'full'};
const startCase = () => clinicalClarification(clinicianInput);

test('a multisystem clinical case asks a bounded set of decision-relevant questions', () => {
  const prompt = startCase();
  assert.equal(prompt.kind, 'clinical');
  assert.equal(prompt.caseQuestion, caseQuestion);
  assert.ok(prompt.questions.length >= 2 && prompt.questions.length <= 3);
  assert.match(prompt.text, /Cardiology.*Hepatology/);
  assert.ok(prompt.questions.some(q => /bleed|anticoagulant/i.test(q)));
  assert.ok(prompt.questions.some(q => /internist|resident|subspecialty/i.test(q)));
});

test('a short role, ward and depth reply retains the original case and completes clarification', () => {
  const pending = startCase();
  const turn = resolveClinicalTurn(clinicianReply, {pending, preferences:clinicalPreferences(pending.clinicalContext)});
  assert.equal(turn.caseQuestion, caseQuestion);
  assert.ok(turn.question.startsWith(caseQuestion));
  assert.ok(turn.question.endsWith(clinicianReply));
  assert.equal(turn.context.perspective, 'general medicine resident');
  assert.equal(turn.context.setting, 'Inpatient ward');
  assert.equal(turn.context.depth, 'full');
  assert.equal(turn.context.clarified, true);
  assert.equal(clinicalClarification({...clinicianInput, question:turn.question, clinicalContext:turn.context}), null);
  assert.equal(clinicalQuestionForTurn(clinicianReply, turn.context), turn.question);
});

test('known clinician role and setting are reused instead of asked again', () => {
  const partial = {perspective:'hepatologist', setting:'Inpatient ward'};
  const prompt = clinicalClarification({...clinicianInput, clinicalContext:partial});
  assert.ok(prompt);
  assert.ok(prompt.questions.some(q => /bleed|anticoagulant/i.test(q)));
  assert.ok(prompt.questions.every(q => !/approaching this|what is the setting|outpatient, ward/i.test(q)));
  assert.equal(clinicalClarification({...clinicianInput, clinicalContext:preferences}), null);
  assert.equal(inferClinicalContext('I am a general internist.').perspective, 'general internist');
});

test('the explicit bypass retains the case without requiring another clarification round', () => {
  const pending = startCase();
  const bypass = pending.choices.find(choice => /assumptions/i.test(choice.label));
  assert.ok(bypass);
  const turn = resolveClinicalTurn(bypass.query, {pending});
  assert.equal(turn.caseQuestion, caseQuestion);
  assert.ok(turn.question.includes(caseQuestion));
  assert.equal(clinicalClarification({...clinicianInput, question:turn.question, clinicalContext:turn.context}), null);
  assert.equal(clinicalClarification({...clinicianInput, question:caseQuestion+' Skip clarification.'}), null);
});

test('simple clinical education and General or browser mode do not receive clinician intake questions', () => {
  for (const question of ['What is cirrhosis?', 'Explain how the heart pumps blood.', 'What is the portal vein?']) {
    assert.equal(clinicalClarification({...clinicianInput, question}), null);
  }
  for (const role of ['General reader', 'General']) {
    assert.equal(clinicalClarification({...clinicianInput, role}), null);
  }
  assert.equal(clinicalClarification({...clinicianInput, mode:'search'}), null);
});

test('negation, uncertainty and laboratory units survive the clarification handoff verbatim', () => {
  const original = '65F with renal disease and possible metabolic acidosis, no dyspnea. Na 139 mmol/L, Cl 103 mmol/L, bicarbonate 18 mmol/L, albumin 2.5 g/dL. Calculate the albumin-corrected anion gap and interpret this case.';
  const pending = clinicalClarification({...clinicianInput, question:original});
  assert.ok(pending);
  const reply = 'No prior sodium correction; repeat bicarbonate is 19 mmol/L. I am an internist in ICU; full calculation please.';
  const turn = resolveClinicalTurn(reply, {pending});
  assert.equal(turn.caseQuestion, original);
  assert.ok(turn.question.startsWith(original));
  assert.ok(turn.question.endsWith(reply));
  assert.equal(turn.context.setting, 'ICU');
  assert.equal(turn.context.depth, 'full');
});

test('setting inference respects an explicitly excluded ICU and ordinary capitalization', () => {
  const ward = inferClinicalContext("I'm a general medicine resident on the medicine ward, not in ICU. Please give a full explanation.");
  assert.equal(ward.setting, 'Inpatient ward');
  const emergency = inferClinicalContext('I am a physician in the Emergency Department.');
  assert.equal(emergency.setting, 'Emergency / acute care');
});

test('a negated subspecialty does not become the clinician perspective', () => {
  assert.equal(inferClinicalContext('I am not a cardiologist.').perspective, undefined);
  const known = {perspective:'hospitalist'};
  assert.equal(inferClinicalContext('Do not answer as a cardiologist.', known).perspective, 'hospitalist');
  assert.equal(inferClinicalContext("I'm a general medicine resident, not a cardiologist.").perspective, 'general medicine resident');
});

test('a decision-specific answer to pending clarification is not mistaken for a new patient', () => {
  const reply = 'No prior variceal bleeding. We need to compare antithrombotic options for cirrhosis and NSTEMI.';
  const turn = resolveClinicalTurn(reply, {pending:startCase(), preferences});
  assert.equal(turn.caseQuestion, caseQuestion);
  assert.ok(turn.question.startsWith(caseQuestion));
  assert.ok(turn.question.endsWith(reply));
  assert.equal(turn.context.clarified, true);
});

test('a complex follow-up about the same patient keeps prior decision-changing facts', () => {
  const reply = 'How should we compare DAPT and anticoagulation for his cirrhosis and NSTEMI?';
  const turn = resolveClinicalTurn(reply, {caseQuestion, preferences});
  assert.equal(turn.caseQuestion, caseQuestion);
  assert.ok(turn.question.startsWith(caseQuestion));
  assert.ok(turn.question.endsWith(reply));
});

test('an explicit new patient resets case details while retaining workflow preferences', () => {
  const next = 'New patient: 42F with RPGN, mononeuritis multiplex and purpura. Prioritize the differential and workup.';
  const turn = resolveClinicalTurn(next, {pending:startCase(), caseQuestion, preferences});
  assert.equal(turn.question, next);
  assert.equal(turn.caseQuestion, next);
  assert.doesNotMatch(turn.question, /cirrhosis|NSTEMI|69M/);
  assert.equal(turn.context.caseQuestion, undefined);
  assert.equal(turn.context.clarified, undefined);
  assert.equal(turn.context.perspective, preferences.perspective);
  assert.equal(turn.context.setting, preferences.setting);
  const education = resolveClinicalTurn('What is leukemia?', {caseQuestion, preferences});
  assert.equal(education.question, 'What is leukemia?');
  assert.equal(education.caseQuestion, '');
});

test('clinical context rejects malformed fields and strips case details from reusable preferences', () => {
  const valid = {...preferences, caseQuestion, clarified:true};
  assert.deepEqual(validateClinicalContext(valid), valid);
  assert.deepEqual(validateClinicalContext(undefined), {});
  assert.deepEqual(clinicalPreferences(valid), preferences);
  assert.deepEqual(inferClinicalContext('Please continue.', preferences), preferences);
  for (const invalid of [null, [], 'ward', {perspective:42}, {setting:'x'.repeat(81)}, {caseQuestion:'x'.repeat(1601)}, {goal:'x\u0000y'}, {depth:'maximum'}, {clarified:'true'}, {clinicallyCertified:true}]) {
    assert.throws(() => validateClinicalContext(invalid), Error);
  }
});

function apiFixture(t) {
  const calls = [], prompts = [];
  let reservations = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (url === 'https://auth.example/auth/v1/user') return Response.json({id:'11111111-1111-4111-8111-111111111111'});
    assert.equal(url, GROQ_CHAT_URL, 'Clinical workflow tests must not perform public retrieval');
    prompts.push(JSON.parse(options.body));
    return Response.json({choices:[{finish_reason:'stop', message:{content:JSON.stringify({answer:[]})}}]});
  });
  const env = {
    SUPABASE_URL:'https://auth.example', SUPABASE_ANON_KEY:'public',
    MODEL_PROVIDER:'groq', GROQ_API_KEY:'test-only', RETRIEVAL_LIVE:'off',
    DB:{prepare(){return {bind(){return {async run(){reservations++;return {meta:{changes:1}};}};}};}},
  };
  const call = (patch={}, authenticated=true) => modelAPI(new Request('https://test.example/api/ai/answer', {
    method:'POST', headers:{'Content-Type':'application/json', ...(authenticated?{Authorization:'Bearer test-only-session'}:{})},
    body:JSON.stringify({...clinicianInput, ...patch}),
  }), env, {});
  return {call, calls, prompts, reservations:()=>reservations};
}

test('API authenticates clinician clarification without calling a model or consuming its quota', async t => {
  const f = apiFixture(t);
  const response = await f.call();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'clarification');
  assert.equal(body.clarification.kind, 'clinical');
  assert.equal(body.clarification.caseQuestion, caseQuestion);
  assert.deepEqual(f.calls, ['https://auth.example/auth/v1/user']);
  assert.equal(f.reservations(), 0);
  assert.equal((await f.call({}, false)).status, 401);
  assert.equal(f.prompts.length, 0);
});

test('API rejects malformed or non-clinician context before authentication or inference', async t => {
  const f = apiFixture(t);
  for (const patch of [
    {clinicalContext:{depth:'maximum'}},
    {clinicalContext:{caseQuestion:'x'.repeat(1601)}},
    {clinicalContext:{clinicallyCertified:true}},
    {role:'General reader', clinicalContext:preferences},
    {mode:'search', clinicalContext:preferences},
  ]) assert.equal((await f.call(patch)).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal(f.reservations(), 0);
});

test('API sends the retained case and clinician clarification together into document-grounded generation', async t => {
  const f = apiFixture(t);
  const turn = resolveClinicalTurn(clinicianReply, {pending:startCase(), preferences});
  const attachments = [{id:'doc-0123456789abcdef', pages:[{number:2, text:'This clinical evidence fixture lists cirrhosis, ascites, portal vein thrombosis, NSTEMI and DES as the terms in the case. It contains no treatment recommendations.'}]}];
  const response = await f.call({question:clinicianReply, clinicalContext:turn.context, attachments});
  assert.equal(response.status, 200);
  assert.ok(f.prompts.length > 0, 'Clarified input must reach the generation step');
  const payload = JSON.parse(f.prompts[0].messages[1].content);
  assert.ok(payload.question.startsWith(caseQuestion));
  assert.ok(payload.question.endsWith(clinicianReply));
  assert.equal(payload.clinicalContext.perspective, 'general medicine resident');
  assert.equal(payload.clinicalContext.setting, 'Inpatient ward');
  assert.equal(payload.clinicalContext.depth, 'full');
  assert.ok(payload.evidence.every(source => source.page === 2));
  assert.equal(f.reservations(), 1);
});
