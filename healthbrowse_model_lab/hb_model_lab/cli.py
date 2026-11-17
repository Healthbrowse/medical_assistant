import argparse
import json
from .training import preflight, train
from .data import read_jsonl, validate_rows, validate_splits


def main():
    parser = argparse.ArgumentParser(description='Separate HealthBrowse medical-model research workspace')
    sub = parser.add_subparsers(dest='command', required=True)
    pre = sub.add_parser('preflight'); pre.add_argument('--config', default='configs/llama3-8b-qlora.json')
    val = sub.add_parser('validate'); val.add_argument('--train', required=True); val.add_argument('--validation', required=True); val.add_argument('--examples', action='store_true')
    run = sub.add_parser('train'); run.add_argument('--config', default='configs/llama3-8b-qlora.json'); run.add_argument('--train', required=True); run.add_argument('--validation', required=True); run.add_argument('--output', required=True); run.add_argument('--smoke', action='store_true')
    ev = sub.add_parser('evaluate'); ev.add_argument('--config', default='configs/llama3-8b-qlora.json'); ev.add_argument('--benchmark', default='evaluation/benchmark.jsonl'); ev.add_argument('--corpus', default='data/education-corpus.jsonl.gz'); ev.add_argument('--output', required=True)
    choice = ev.add_mutually_exclusive_group(required=True); choice.add_argument('--baseline', action='store_true'); choice.add_argument('--adapter')
    comp = sub.add_parser('compare'); comp.add_argument('--baseline', required=True); comp.add_argument('--adapter', required=True); comp.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'preflight':
        result = preflight(args.config)
    elif args.command == 'validate':
        tr, va = [validate_rows(read_jsonl(p), allow_examples=args.examples) for p in [args.train, args.validation]]
        validate_splits(tr, va)
        result = {'train': len(tr), 'validation': len(va), 'split_check': 'passed', 'training_started': False, 'clinical_validation': False}
    elif args.command == 'train':
        result = train(args.config, args.train, args.validation, args.output, args.smoke)
    elif args.command == 'evaluate':
        from .evaluation import evaluate
        result = evaluate(args.config, args.benchmark, args.corpus, args.output, adapter=args.adapter, baseline=args.baseline)
    else:
        from .evaluation import compare
        result = compare(args.baseline, args.adapter, args.output)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
