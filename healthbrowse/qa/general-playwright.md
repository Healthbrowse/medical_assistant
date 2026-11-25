# Compare models in the General Browser and Buddy

This suite opens the HealthBrowse web app in Chromium. Browser cases type in the search box. Buddy cases start a fresh chat with the model picker set to the selected provider. Each case gets a fresh browser context so a previous topic, login or answer cannot leak into another result.

## Run without using provider credits

Use the app's Node 24 runtime and Python 3.10 or later. From the repository root:

```sh
cd healthbrowse
npm ci
npm run build
python -m pip install playwright==1.62.0
python -m playwright install chromium

python qa/general-playwright.py --surface browser --models gemma
python qa/general-playwright.py --surface buddy --models gemma
```

Run both surfaces and every profile with `python qa/general-playwright.py`. To use an existing Chromium installation, add `--chromium /path/to/chromium`. Linux CI images without the browser's system libraries can use `python -m playwright install --with-deps chromium`.

The default run uses local evidence, a synthetic QA session and deterministic provider replies. The production UI, API route, generation prompts, citation checks, fallback logic and rendering run in the test. The fixture also simulates a Gemma HTTP 429 to verify the backup attribution. This run measures integration behavior. Its timings and outputs cannot establish model speed or clinical accuracy.

## Model profiles

| CLI name | Model | Purpose in this suite |
|---|---|---|
| `gemma` | Cloudflare Gemma 4 26B A4B IT | Current General primary, with the configured Groq backup available when a key is supplied |
| `oss` | Groq GPT-OSS-120B | Exercise the backup model directly. The standalone Groq Browser configuration also uses GPT-OSS-20B for source review |
| `deepseek` | DeepSeek-R1-Distill-Llama-8B via Hugging Face | Existing optional route. Provider access and available credits are required for live use |
| `qwen` | Cloudflare Qwen3.8-27B | Existing clinician model tested with the General prompts |
| `llama` | Cloudflare Llama 3.3 70B Instruct FP8 Fast | Candidate for General answers |
| `mistral` | Cloudflare Mistral Small 3.1 24B Instruct | Candidate for General answers |
| `gemma-fallback` | Gemma → GPT-OSS-120B | Offline-only simulated provider limit |

Candidate selection is confined to the QA process. Each candidate receives the app's retrieved passages and undergoes the app's source review. The bridge uses the model's actual identifier throughout. In live mode it calls fixed vendor HTTPS endpoints from Node and keeps credentials outside the browser. The local session, quota database and auxiliary services are simulated, and retrieval uses the installed snapshot. A live run measures this local app configuration against real providers. Production capacity and end-to-end production latency require a separate deployment test.

## Run one small live comparison

Set credentials in the shell running the suite. Cloudflare profiles use `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with Workers AI inference permission. Groq uses `GROQ_API_KEY`. DeepSeek uses `HF_TOKEN` with inference-provider access. The suite reads existing environment variables and never prints their values. No model is invoked live unless you pass `--live`.

```sh
python qa/general-playwright.py --live --models gemma --case daily-bp --max-calls 4
```

This asks the same published question once on each surface. Generation and source review normally use two provider calls per answer. Each attempted provider call counts, including errors, review and fallback. The cap applies across all models and surfaces in that invocation. It limits calls, not tokens or currency. Opening a cited daily-management deck should use zero extra model calls. A missing credential, exhausted budget or source-only result is recorded distinctly. Choose just one surface to reduce the run further:

```sh
python qa/general-playwright.py --live --surface browser --models llama,mistral --case diabetes --max-calls 4
```

Live provider availability and account allowances vary. A deployment or Cloudflare preview is unnecessary for these runs.

## Read the results

Each execution writes a timestamped directory under `qa-results/general-playwright/fixture/` or `qa-results/general-playwright/live/`. Override that parent with `--out`. The directory contains a `comparison.md` table and a separate `browser.json` or `buddy.json` for each surface you ran.

The JSON records requested and displayed generator, reviewer, provider attempts, fallback reason and phase, elapsed time, rendered answer, citation URLs, and deck contents. Where available, live provider attempts include reported model IDs and token counts. Emergency redirects should have no generator and no inference calls. Data is limited to the synthetic questions in `general-model-cases.json`.

The checks flag wrong mode, wrong model, missing attribution, missing citations, topic omissions, empty routine decks and missing emergency guidance. The hypertension case also opens the activity deck in Buddy and checks the focused, cited reply. A real unexpected switch to the backup remains visible as a primary failure. A simulated switch passes only when the expected 429 and model are shown. The command exits nonzero for failures or incomplete comparisons. Read the generated text and its supporting passages before drawing conclusions about medical accuracy. Add new public, synthetic questions and expected concepts to the case file for broader coverage.

Provider references: [Workers AI chat completions](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [Llama model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/), [Mistral model](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/).
