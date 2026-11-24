# CDC NNDSS adapter experiment

[Open the training notebook on the PR branch in Colab](https://colab.research.google.com/github/abby2395/medical_chatbot/blob/research/buddy-nndss-adapters/healthbrowse/inference/nndss/CDC_NNDSS_Buddy_Adapters.ipynb). After merge, use [the notebook on main](https://colab.research.google.com/github/abby2395/medical_chatbot/blob/main/healthbrowse/inference/nndss/CDC_NNDSS_Buddy_Adapters.ipynb).

The experiment fits separate four-class surveillance classifiers to the three selectable Buddy text-generation checkpoints. Groq hosts one of the base models. All optimization happens on a separate GPU. The DeepSeek planning model is outside this experiment.

| Base checkpoint | Colab starting point | Adapter |
|---|---|---|
| `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` | T4 or larger | NF4 QLoRA on attention query and value projections |
| `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` | G4 or another GPU with at least 21 GiB free | NF4 QLoRA on attention query and value projections |
| `openai/gpt-oss-120b` | High-memory G4 with at least 75 GiB free, BF16 and compatible MXFP4 kernels | LoRA on the output head, with frozen MXFP4 experts |

Free-memory thresholds are checks for this short-input, single-GPU recipe. Actual fit also depends on the CUDA build, kernels and other allocations. Allow disk space for the original checkpoint download even when quantizing on load. The 120B route uses the native open-weight checkpoint. Groq currently lists Llama 3.1 8B Instant for custom LoRA inference and requires enterprise access. Selecting the public GPT-OSS model ID in Buddy continues to use Groq's base model. [Groq LoRA support](https://console.groq.com/docs/lora)

## Data and evaluation

The source is CDC's [NNDSS Weekly Data](https://data.cdc.gov/d/x9gk-5huc). The default benchmark scores weeks 1–4 of each available year from 2014 onward. The loader also fetches the preceding year’s final reporting week when needed for week 1. Those extra rows supply history only. The November 2026 snapshot returned 2022–2026. To include every week available, run `prepare.py --weeks 53`. CDC may revise historical records. Preserve the prepared files to reproduce a comparison.

Each input contains the condition, reporting area, MMWR year/week and the previous week's reported count when the same condition and area have a usable count exactly seven days earlier. This includes week 52 or 53 of the preceding MMWR year. Gaps retain the value `unknown`. Current counts and flags are excluded from the inputs. A numeric current count takes precedence over a dash. A missing count with a dash means no cases were reported. Other missing, unavailable and nonreportable values are excluded. The four labels are `no_reported_cases`, `low`, `medium` and `high`. Positive tier boundaries come from the training years alone. These tiers describe aggregate reports and have no patient-level diagnostic interpretation.

The most recent year is the test split and the preceding year is validation. Models use the same frozen files. Evaluation uses the relative scores of four single-token choices mapped to the labels. The original MedGemma run excluded flag-only rows and used a different sample. Its published scores require reevaluation on these splits for a paired comparison.

The checked-in [baseline snapshot](benchmark-snapshot.json) predates the year-boundary fix and records the source version, split hashes, class supports and CPU baseline results. It contains no large-model scores.

## Corrected DeepSeek 8B validation run

Import [the corrected notebook](HealthBrowse_DeepSeek_8B_Corrected_Kaggle.ipynb) into Kaggle with Internet and a T4 GPU. It restores the two checksummed splits, trains for one class-weighted LoRA epoch on 4,096 records from 2022–2024 and compares all methods on the same 256 records from 2025. At 32 records per optimizer step, the run completed 128 steps.

| Method | Macro F1 | Positive records detected out of 32 | False alarms among 224 zero-count records |
| --- | ---: | ---: | ---: |
| Carry-forward | 0.7094 | 28 | 6 |
| DeepSeek 8B adapter | 0.5534 | 28 | 13 |
| TF–IDF logistic regression | 0.4478 | 29 | 48 |

Carry-forward uses the previous reporting week’s count band for the same disease and area. For scoring, a missing prior count defaults to zero. Both leading methods detected the same 28 positive records. The adapter correctly identified all 14 high-band records and two of five medium-band records. Carry-forward identified 11 high-band and four medium-band records. We retained carry-forward as the research benchmark and paused larger GPU runs. [Validation metrics](results/deepseek-8b-corrected/validation_metrics.json) · [Paired predictions](results/deepseek-8b-corrected/validation_predictions.csv)

A separate frozen CPU comparison examined 327,707 eligible disease-area records in 2026 reporting weeks 5–45. Only 84 lacked a usable previous count. Using logistic regression for those gaps detected one additional positive record and produced six additional false alarms. [Evaluation protocol](results/carry-forward-fallback-protocol.json) · [Results](results/carry-forward-fallback-2026.json)

## Run on a CUDA host

From this directory, install CUDA-compatible PyTorch plus the training dependencies pinned in the notebook. The data stage also uses pandas and scikit-learn. The optional `SOCRATA_APP_TOKEN` is read from the training process environment and sent to CDC in a request header. The GPU training stage reads only the prepared dataset.

```sh
python prepare.py --out /tmp/nndss-data
python train.py --model deepseek-ai/DeepSeek-R1-Distill-Llama-8B --data /tmp/nndss-data --out /tmp/nndss-8b
python -m unittest -v test_nndss
```

Each run writes a PEFT adapter and a metrics file with the base revision, training steps, benchmark hash, base test scores and adapted validation/test scores. Use a separate output directory for each model. The notebook downloads this output as a ZIP.
