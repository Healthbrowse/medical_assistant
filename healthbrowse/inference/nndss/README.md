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

The source is CDC's [NNDSS Weekly Data](https://data.cdc.gov/d/x9gk-5huc). The default benchmark downloads weeks 1–4 of each available year from 2014 onward. The November 2026 snapshot returned 2022–2026. To include every week available, run `prepare.py --weeks 53`. CDC may revise historical records. Preserve the prepared files to reproduce a comparison.

Each input contains the condition, reporting area, MMWR year/week and the previous week's reported count when available within the same reporting year. Current counts and flags are excluded from the inputs. A numeric current count takes precedence over a dash. A missing count with a dash means no cases were reported. Other missing, unavailable and nonreportable values are excluded. The four labels are `no_reported_cases`, `low`, `medium` and `high`. Positive tier boundaries come from the training years alone. These tiers describe aggregate reports and have no patient-level diagnostic interpretation.

The most recent year is the test split and the preceding year is validation. Models use the same frozen files. Evaluation uses the relative scores of four single-token choices mapped to the labels. The original MedGemma run excluded flag-only rows and used a different sample. Its published scores require reevaluation on these splits for a paired comparison.

The checked-in [baseline snapshot](benchmark-snapshot.json) records the source version, split hashes, class supports and CPU baseline results. It contains no large-model scores.

## Run on a CUDA host

From this directory, install CUDA-compatible PyTorch plus the training dependencies pinned in the notebook. The data stage also uses pandas and scikit-learn. The optional `SOCRATA_APP_TOKEN` is read from the training process environment and sent to CDC in a request header. The GPU training stage reads only the prepared dataset.

```sh
python prepare.py --out /tmp/nndss-data
python train.py --model deepseek-ai/DeepSeek-R1-Distill-Llama-8B --data /tmp/nndss-data --out /tmp/nndss-8b
python -m unittest -v test_nndss
```

Each run writes a PEFT adapter and a metrics file with the base revision, training steps, benchmark hash, base test scores and adapted validation/test scores. Use a separate output directory for each model. The notebook downloads this output as a ZIP.
