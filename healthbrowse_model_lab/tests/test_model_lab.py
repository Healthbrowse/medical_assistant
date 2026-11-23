import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from hb_model_lab.api import create_app
from hb_model_lab.contracts import Query, validate_answer
from hb_model_lab.data import read_jsonl, validate_rows, validate_splits, encode_row, canonical_url
from hb_model_lab.training import load_config, train
from hb_model_lab.runtime import adapter_manifest, safety_intercept
from hb_model_lab.retrieval import Corpus
from hb_model_lab.evaluation import evaluate, compare

ROOT = Path(__file__).resolve().parents[1]
TRAIN = ROOT / 'data/examples/train.jsonl'
VALIDATION = ROOT / 'data/examples/validation.jsonl'
CONFIG = ROOT / 'configs/llama3-8b-qlora.json'

class FakeTokenizer:
    # A deterministic chat template for unit testing label boundaries only.
    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        text = ''.join('<' + m['role'] + '>' + m['content'] + '</end>' for m in messages)
        if add_generation_prompt:
            text += '<assistant>'
        return list(text.encode())

class DataTests(unittest.TestCase):
    def setUp(self):
        self.rows = read_jsonl(TRAIN)
        self.query = Query.model_validate(self.rows[0]['input'])

    def test_two_personas_and_separate_config(self):
        c = load_config(CONFIG)
        self.assertEqual(c['roles'], ['general', 'clinician'])
        self.assertFalse(c['production_routing'])
        self.assertEqual(len(c['revision']), 40)

    def test_illustrations_never_masquerade_as_reviewed_training(self):
        with self.assertRaisesRegex(ValueError, 'Illustrative'):
            validate_rows(self.rows)
        validate_rows(self.rows, allow_examples=True)

    def test_review_and_rights_required_for_real_training(self):
        row = copy.deepcopy(self.rows[0]); row['example_only'] = False
        with self.assertRaisesRegex(ValueError, 'review'):
            validate_rows([row])
        row['review'] = {'status':'approved','reviewer':'test-reviewer','claim_support_checked':True}
        validate_rows([row])
        row['rights'] = {}
        with self.assertRaisesRegex(ValueError, 'rights'):
            validate_rows([row])

    def test_source_and_topic_split(self):
        validate_splits(self.rows, read_jsonl(VALIDATION))
        for field in ['id', 'topic_group']:
            other = copy.deepcopy(read_jsonl(VALIDATION)); other[0][field] = self.rows[0][field]
            with self.assertRaisesRegex(ValueError, 'leakage'):
                validate_splits(self.rows, other)

    def test_page_fragments_do_not_hide_leakage(self):
        other = copy.deepcopy(read_jsonl(VALIDATION))
        other[0]['input']['evidence'][0]['url'] = self.rows[0]['input']['evidence'][0]['url'] + '?x=2#paragraph'
        with self.assertRaisesRegex(ValueError, 'pages'):
            validate_splits(self.rows, other)

    def test_same_text_on_different_url_is_leakage(self):
        other = copy.deepcopy(read_jsonl(VALIDATION))
        other[0]['input']['evidence'][0]['text'] = self.rows[0]['input']['evidence'][0]['text']
        with self.assertRaisesRegex(ValueError, 'passages'):
            validate_splits(self.rows, other)

    def test_unknown_citations_rejected(self):
        target = copy.deepcopy(self.rows[0]['target'])
        target['answer'][0]['citations'][0]['source_id'] = 'FAKE'
        with self.assertRaisesRegex(ValueError, 'absent'):
            validate_answer(target, self.query)

    def test_invented_quotes_rejected(self):
        target = copy.deepcopy(self.rows[0]['target'])
        target['answer'][0]['citations'][0]['quote'] = 'This invented source text is not in the evidence.'
        with self.assertRaisesRegex(ValueError, 'absent'):
            validate_answer(target, self.query)

    def test_search_and_chat_have_different_structures(self):
        target = self.rows[0]['target']
        validate_answer(target, self.query)
        with self.assertRaisesRegex(ValueError, 'chat requires none'):
            validate_answer(target, self.query.model_copy(update={'mode':'chat'}))

    def test_uncited_message_cannot_bypass_claim_contract(self):
        target = copy.deepcopy(self.rows[0]['target']); target['message'] = 'An uncited medical statement.'
        with self.assertRaisesRegex(ValueError, 'uncited'):
            validate_answer(target, self.query)

    def test_clarification_requires_choices(self):
        with self.assertRaisesRegex(ValueError, 'options'):
            validate_answer({'status':'clarify','message':'Which result?'}, self.query)
        validate_answer({'status':'clarify','message':'Which result?','choices':['Blood test','Scan']}, self.query)

    def test_duplicate_sources_and_third_persona_rejected(self):
        with self.assertRaises(ValueError):
            Query.model_validate({**self.rows[0]['input'], 'role':'student'})
        with self.assertRaises(ValueError):
            Query.model_validate({**self.rows[0]['input'], 'evidence':self.rows[0]['input']['evidence']*2})

    def test_assistant_only_labels_without_truncation(self):
        r = encode_row(self.rows[0], FakeTokenizer(), 16000)
        self.assertTrue(any(x == -100 for x in r['labels']))
        self.assertTrue(any(x != -100 for x in r['labels']))
        first = next(i for i,v in enumerate(r['labels']) if v != -100)
        self.assertEqual(r['labels'][first:], r['input_ids'][first:])
        self.assertEqual(bytes(r['labels'][first:]).decode(), json.dumps(self.rows[0]['target'],ensure_ascii=False)+'</end>')
        with self.assertRaisesRegex(ValueError, 'never silently truncate'):
            encode_row(self.rows[0], FakeTokenizer(), 40)

    def test_prefix_mismatch_rejected(self):
        class Broken(FakeTokenizer):
            def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
                return [1] if add_generation_prompt else [2,3]
        with self.assertRaisesRegex(ValueError, 'prefix mismatch'):
            encode_row(self.rows[0], Broken(), 4096)

    def test_checkpoint_overwrite_and_gpu_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'never overwritten'):
                train(CONFIG, TRAIN, VALIDATION, directory, smoke=True)
            with patch('hb_model_lab.training.preflight', return_value={'cuda':False,'packages':{}}):
                with self.assertRaisesRegex(RuntimeError, 'CUDA'):
                    train(CONFIG, TRAIN, VALIDATION, Path(directory)/'new', smoke=True)

    def test_tampered_or_smoke_adapter_cannot_be_served(self):
        c = load_config(CONFIG)
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory); a = d/'adapter'; a.mkdir(); (a/'adapter_model.safetensors').write_bytes(b'test-fixture')
            (a/'adapter_config.json').write_text(json.dumps({'base_model_name_or_path':c['base_model']}))
            m = {'status':'trained','config':c,'smoke_only':False,'adapter_sha256':hashlib.sha256(b'test-fixture').hexdigest(),'adapter_config_sha256':hashlib.sha256((a/'adapter_config.json').read_bytes()).hexdigest()}
            (d/'run-manifest.json').write_text(json.dumps(m)); adapter_manifest(a,c)
            (a/'adapter_model.safetensors').write_bytes(b'altered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'): adapter_manifest(a,c)
            m['smoke_only']=True; (d/'run-manifest.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'Smoke-test'): adapter_manifest(a,c)

    def test_source_urls_do_not_allow_embedded_credentials(self):
        with self.assertRaises(ValueError): canonical_url('https://user:password@example.org/source')

class APIAndEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.row = read_jsonl(TRAIN)[0]
        self.key = 'local-test-key-not-a-real-secret'
        target = self.row['target']
        class Runner:
            def answer(self, query): return target
        self.runner = Runner()

    def test_disabled_without_separate_key_or_weights(self):
        with TestClient(create_app(api_key='')) as client:
            self.assertEqual(client.get('/healthz').status_code,503)
            self.assertEqual(client.post('/v1/answer',json=self.row['input']).status_code,503)
        with TestClient(create_app(api_key=self.key)) as client:
            self.assertEqual(client.post('/v1/answer',json=self.row['input'],headers={'Authorization':'Bearer '+self.key}).status_code,503)

    def test_auth_validated_before_model_and_responses_are_research_labeled(self):
        with TestClient(create_app(self.runner, self.key)) as client:
            self.assertEqual(client.get('/healthz').status_code,200)
            self.assertEqual(client.post('/v1/answer',json=self.row['input']).status_code,401)
            r=client.post('/v1/answer',json=self.row['input'],headers={'Authorization':'Bearer '+self.key})
            self.assertEqual(r.status_code,200); self.assertTrue(r.json()['research_only'])
            self.assertIn('not independently validated',r.json()['verification'])
            self.assertEqual(r.headers['cache-control'],'no-store')

    def test_invalid_model_output_is_not_returned_as_an_answer(self):
        self.runner.answer = lambda q: {'status':'answer','message':'No citations here'}
        with TestClient(create_app(self.runner, self.key)) as client:
            self.assertEqual(client.post('/v1/answer',json=self.row['input'],headers={'Authorization':'Bearer '+self.key}).status_code,422)

    def test_oversize_requests_are_rejected(self):
        with TestClient(create_app(self.runner,self.key)) as client:
            self.assertEqual(client.post('/v1/answer',content=b'x'*100001).status_code,413)

    def test_obvious_unsafe_self_procedures_intercepted_but_education_allowed(self):
        query = Query.model_validate(self.row['input'])
        for q in ['How can I stitch myself?', 'Give surgery steps at home', 'What is the lethal dose?']:
            self.assertEqual(safety_intercept(query.model_copy(update={'question':q})).status,'refuse')
        for q in ['What are mitochondria?', 'Why do doctors suture wounds?', 'What is an opioid overdose?']:
            self.assertIsNone(safety_intercept(query.model_copy(update={'question':q})))

    def test_frozen_corpus_integrity_and_mitochondria_retrieval(self):
        corpus_path=ROOT/'data/education-corpus.jsonl.gz'; manifest=json.loads((ROOT/'data/corpus-manifest.json').read_text())
        self.assertEqual(hashlib.sha256(corpus_path.read_bytes()).hexdigest(),manifest['corpus_sha256'])
        corpus=Corpus(corpus_path); self.assertEqual(len(corpus.rows),manifest['passages'])
        found=corpus.search('What is mitochondria?')
        self.assertTrue(any('A mitochondrion' in s.text for s in found))
        self.assertTrue(all(s.url.startswith('https://github.com/openstax/') for s in found))

    def test_benchmark_has_100_questions_and_both_modes_run(self):
        cases=read_jsonl(ROOT/'evaluation/benchmark.jsonl')
        self.assertEqual(len(cases),100); self.assertEqual(len({r['id'] for r in cases}),100)
        with tempfile.TemporaryDirectory() as directory:
            d=Path(directory); b=d/'cases.jsonl';b.write_text(json.dumps(cases[0])+'\n')
            class EvidenceGap:
                def answer(self,q): return {'status':'insufficient_evidence','message':'No verified answer available.'}
            summary=evaluate(CONFIG,b,ROOT/'data/education-corpus.jsonl.gz',d/'eval',baseline=True,runner=EvidenceGap())
            self.assertEqual(summary['n'],2); self.assertIsNone(summary['medical_accuracy'])
            self.assertEqual(len(read_jsonl(d/'eval/predictions.jsonl')),2)
            self.assertTrue((d/'eval/human-review.csv').is_file())
            with self.assertRaisesRegex(ValueError,'fresh'):
                evaluate(CONFIG,b,ROOT/'data/education-corpus.jsonl.gz',d/'eval',baseline=True,runner=EvidenceGap())

if __name__=='__main__': unittest.main()
