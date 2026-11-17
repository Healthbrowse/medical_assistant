"""Generate held-out predictions; software metrics are never called clinical accuracy."""
import csv
import hashlib
import json
import time
from pathlib import Path
from .contracts import Query, validate_answer
from .data import read_jsonl, digest
from .retrieval import Corpus
from .runtime import ModelRunner


def evaluate(config_path, benchmark, corpus_path, output, adapter=None, baseline=False, runner=None):
    out = Path(output)
    if out.exists():
        raise ValueError('Use a fresh evaluation output directory')
    cases = read_jsonl(benchmark)
    corpus = Corpus(corpus_path)
    runner = runner or ModelRunner(config_path, adapter=adapter, baseline=baseline)
    out.mkdir(parents=True, exist_ok=False)
    manifest = {'benchmark_sha256': digest(benchmark), 'corpus_sha256': digest(corpus_path), 'config_sha256': digest(config_path),
                'condition': 'base_with_retrieval' if baseline else 'adapter_with_retrieval', 'adapter_sha256': digest(Path(adapter) / 'adapter_model.safetensors') if adapter else None,
                'clinical_evaluation': 'pending', 'production_approved': False}
    (out / 'evaluation-manifest.json').write_text(json.dumps(manifest, indent=2))
    predictions = []
    for case in cases:
        for role in ['general', 'clinician']:
            evidence = corpus.search(case['question'])
            query = Query(question=case['question'], role=role, mode=case.get('mode', 'search'), topic_kind=case.get('topic_kind', 'knowledge'), evidence=evidence, history=case.get('history', []))
            start = time.monotonic()
            try:
                result = runner.answer(query)
                result = validate_answer(result.model_dump() if hasattr(result, 'model_dump') else result, query)
                error = None
            except Exception as exc:
                result, error = None, type(exc).__name__
            row = {'id': case['id'] + ':' + role, 'category': case['category'], 'expected_behavior': case['expected_behavior'],
                   'query': query.model_dump(), 'answer': result.model_dump() if result else None, 'contract_valid': result is not None,
                   'error_type': error, 'latency_seconds': round(time.monotonic() - start, 3), 'retrieval_count': len(evidence)}
            predictions.append(row)
            with (out / 'predictions.jsonl').open('a') as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    summary = {'n': len(predictions), 'contract_valid_rate': sum(r['contract_valid'] for r in predictions) / len(predictions),
               'retrieval_nonempty_rate': sum(r['retrieval_count'] > 0 for r in predictions) / len(predictions),
               'mean_latency_seconds': sum(r['latency_seconds'] for r in predictions) / len(predictions),
               'medical_accuracy': None, 'claim_support_accuracy': None, 'review_status': 'human_review_required'}
    (out / 'software-metrics.json').write_text(json.dumps(summary, indent=2))
    with (out / 'human-review.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['id', 'reviewer', 'question_answered_0_2', 'claim_support_0_2', 'audience_fit_0_2', 'safe_0_1', 'notes'])
        writer.writerows([[r['id'], '', '', '', '', '', ''] for r in predictions])
    return summary


def compare(base_dir, adapter_dir, output):
    left, right = [Path(p) for p in [base_dir, adapter_dir]]
    a, b = [json.loads((p / 'evaluation-manifest.json').read_text()) for p in [left, right]]
    for key in ['benchmark_sha256', 'corpus_sha256', 'config_sha256']:
        if a[key] != b[key]:
            raise ValueError('Comparison requires identical benchmark, corpus and model configuration')
    if a['condition'] != 'base_with_retrieval' or b['condition'] != 'adapter_with_retrieval':
        raise ValueError('Compare base_with_retrieval to adapter_with_retrieval')
    predictions = [read_jsonl(p / 'predictions.jsonl') for p in [left, right]]
    if {r['id'] for r in predictions[0]} != {r['id'] for r in predictions[1]}:
        raise ValueError('Both evaluations must contain the same completed cases')
    result = {'base': json.loads((left / 'software-metrics.json').read_text()), 'adapter': json.loads((right / 'software-metrics.json').read_text()),
              'conclusion': 'Software metrics only. Complete independent blinded answer review before claiming quality improvement.', 'production_approved': False}
    path = Path(output)
    with path.open('x') as stream:
        json.dump(result, stream, indent=2)
    return result
