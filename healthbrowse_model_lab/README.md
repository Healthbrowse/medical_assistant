# HealthBrowse Medical Model Lab

**Status: separate research implementation; no newly trained weights or medical-quality results yet.** This project trains an independent QLoRA adapter based on `meta-llama/Meta-Llama-3-8B-Instruct`. It is not a foundation model trained from random weights. The base revision is pinned to `8afb486c1db24fe5011ec46dfbe5b5dccdb575c2`; an eventual release retains the base model's licence and attribution.

The existing HealthBrowse browser and its Groq model are unchanged. This directory does not import the browser, change its provider settings, share its API keys, read its user/chat database, or automatically deploy a model. The research service uses port **8011** and a separate `HBM_API_KEY`.

## What is implemented

- One adapter training profile with exactly **General** and **Clinicians** audiences.
- A shared prompt/output contract for training, evaluation and local inference: answer first; six knowledge or disease sections for search; a focused answer for Buddy-style follow-ups.
- Source-ID and exact-quote validation, explicit evidence gaps and multiple-choice clarification.
- Assistant-only training labels, no silent token truncation, deterministic seeds, pinned base weights, dataset hashes and immutable run directories.
- A frozen, attributed OpenStax retrieval corpus: 4,021 passages from 198 modules of the earlier CC BY 4.0 snapshot. It is educational material, not a collection of current treatment guidelines.
- A **draft 100-question evaluation set**, run in both modes (200 cases), including mitochondria, pituitary, bilirubin, symptoms, ambiguity and unsafe requests.
- A baseline-versus-adapter evaluation runner that freezes the corpus and questions; it exports predictions, software metrics and a human-review sheet. It does not label citation syntax or JSON validity as medical accuracy.
- A separate authenticated FastAPI research service, with no fallback to the live provider.

The eight included example records (four train, four validation) are **exact source excerpts for plumbing tests**. They do not teach polished persona differences and are not sufficient training data. Ordinary training refuses them; `--smoke` permits only one training step and the API refuses smoke artifacts.

## Start locally without a GPU

Use Python 3.11–3.13, preferably 3.12:

```bash
cd healthbrowse_model_lab
python -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
python -m unittest discover -s tests -v
hb-model validate --train data/examples/train.jsonl --validation data/examples/validation.jsonl --examples
hb-model preflight
```

Preflight reports installed dependencies and CUDA availability. It does not download weights, start a paid job or claim training has occurred. The implementation was checked on CPU; the CUDA training/inference path still needs a real GPU smoke run.

## Train the separate model

For the first run use [the Colab notebook](notebooks/HealthBrowse_Medical_Model_Lab.ipynb). It explains the difference between a one-step smoke test and training on reviewed files. It saves to its own Drive run directory and records source/data versions.

On a Linux CUDA workstation with access to the gated Llama repository:

```bash
pip install -e '.[train]'
# Supply HF_TOKEN through your secret manager/environment, never source code.
hb-model preflight
hb-model train --train data/examples/train.jsonl --validation data/examples/validation.jsonl --output runs/smoke-001 --smoke
```

A GPU with 24 GB or more VRAM is a reasonable initial planning target, not a measured requirement or guarantee for this implementation. Free Colab GPU availability varies. Reduce training sequence length only after checking full-example token lengths; never silently truncate questions, evidence or targets. No GPU time has been purchased by this project.

For an actual candidate, prepare `data/curated/train.jsonl` and `validation.jsonl` using [DATASET.md](DATASET.md), then:

```bash
hb-model validate --train data/curated/train.jsonl --validation data/curated/validation.jsonl
hb-model train --train data/curated/train.jsonl --validation data/curated/validation.jsonl --output runs/candidate-001
```

A completed run contains `adapter/adapter_model.safetensors`, tokenizer files and `run-manifest.json`. These are a derivative adapter plus metadata, not a standalone copy of all base weights. The manifest records that clinical validation has not occurred. A training failure preserves a `failed` manifest; use a new output directory for the next attempt. Resume is deliberately not implemented in this initial isolated runner.

## Compare answers before considering integration

```bash
hb-model evaluate --baseline --output runs/eval-base-001
hb-model evaluate --adapter runs/candidate-001/adapter --output runs/eval-adapter-001
hb-model compare --baseline runs/eval-base-001 --adapter runs/eval-adapter-001 --output runs/comparison-001.json
```

These commands load local weights and perform real inference; they require a GPU and can take substantial time. Do not run them until the training and inference smoke checks pass. The baseline and adapter use the same prompt, 4-bit base loading, corpus, retrieval and generation settings. Retrieval is deliberately a transparent lexical baseline; it can miss relevant evidence. Empty retrieval and output-contract failures are recorded separately. See [EVALUATION.md](EVALUATION.md) for review and leakage requirements.

## Serve only the research model

Set `HBM_API_KEY` to a separate random secret of at least 24 characters, and `HBM_MODEL_DIR` to the completed candidate's `adapter` directory. No production key is read.

```bash
export HBM_MODEL_DIR="$PWD/runs/candidate-001/adapter"
export HBM_CONFIG="$PWD/configs/llama3-8b-qlora.json"
uvicorn hb_model_lab.api:app --host 127.0.0.1 --port 8011 --no-access-log
```

`GET /healthz` returns 503 until a real compatible adapter and research credential are configured. `POST /v1/answer` accepts a `Query` JSON object (see an example's `input`) and requires `Authorization: Bearer <HBM_API_KEY>`. Callers supply retrieved passages explicitly; the model cannot fetch URLs, access accounts or execute tools. The service checks citation membership and exact quotes, not full semantic truth. Invalid output is rejected; it is never silently replaced by a call to Groq.

A Dockerfile is supplied for a separate CUDA-enabled host with the NVIDIA container runtime. Bind port 8011 to loopback, mount the candidate and cache explicitly, and inject secrets at runtime. The image is an initial research packaging recipe, not a tested production deployment. Do not publicly expose this service or send patient records to it.

## Repository boundaries and next milestones

All additions live in `healthbrowse_model_lab/`, plus its path-scoped CPU CI workflow. There is no browser provider switch, database migration, production secret, automatic training workflow or deployment job.

1. Curate reviewed, source-grounded examples for both audiences and search/chat modes.
2. Run the GPU smoke notebook and record memory use, tokenizer lengths and runtime.
3. Train a candidate and compare it with the unchanged base model on a genuinely held-out benchmark.
4. Obtain independent clinical and usability review. Only then propose a separately reviewed integration change.

## References

- [Llama 3 model card](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
- [QLoRA research paper](https://arxiv.org/abs/2305.14314)
- [PEFT quantization](https://huggingface.co/docs/peft/developer_guides/quantization)
- [Transformers 4.57.1 Trainer documentation](https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/trainer)
- [Pinned OpenStax source and licence](https://github.com/openstax/osbooks-anatomy-physiology/tree/b0058a743bdd2cc08196abaaa7d5469970c0d80c)

The corpus retains its CC BY 4.0 attribution and licence separately. Newer OpenStax revisions may have different terms; this project does not authorize ingesting them. No additional licence for the existing repository or Llama weights is implied by these files.
