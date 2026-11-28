# Model availability audit — 28 November 2026

## Scope and release status

This audit separates live application configuration, provider catalog evidence, synthetic inference results, and pending account checks. It is not a clinical validation or certification. The candidate changes are intended for the staging branch before promotion to production.

The public production configuration was read in a browser from `https://healthbrowse-ai.abhaysrivastava518.workers.dev/api/config` and `/api/ai/status`. Production advertised five answer checkpoints, selected Workers AI by default, and reported a configured Groq fallback. Sarvam was not exposed by that deployed build. Configuration status is not proof of successful inference.

The GitHub baseline was `02bbc730508097372c4269bc5a10cc0e4baef864`, the merge of PR #36. Production's exact deployed commit and Cloudflare Builds settings were not available from the public configuration endpoint.

## Findings and candidate changes

| Checkpoint | Observed role | Verified evidence | Candidate action |
| --- | --- | --- | --- |
| `@cf/google/gemma-4-26b-a4b-it` | Production General answer and planner | Advertised by production; current official Cloudflare catalog entry | Retain. Run pinned inference with the production account/binding before marking healthy. |
| `@cf/qwen/qwen3.8-27b` | Production clinician answer | Advertised by production; current official Cloudflare catalog entry | Retain. Run pinned account inference. |
| `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` | Production selectable General answer | Absent from the live HTTP 200 Hugging Face router model catalog | Disable this exact ID in the candidate configuration. This is a hosting-availability finding, not global retirement of the weights. |
| `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` | Production selectable clinician answer | Absent from the same live router catalog | Disable this exact ID in the candidate configuration. |
| `openai/gpt-oss-120b` | Production selectable answer and configured fallback | Advertised by production; current official Groq production catalog entry | Retain. Verify account access and pinned generation/review. |
| `openai/gpt-oss-20b` | Hidden automatic Groq reviewer in source | Current official Groq production catalog entry | Retain; audit separately from the 120B generator. |
| `deepseek-ai/DeepSeek-V3.2` | Hidden HF literature planner in source | Present in the live router catalog with three providers reporting `live` | Retain. Catalog availability is not an account inference result. |
| `deepseekv4.1-flash-1017` | Private testing Site's Sarvam alternative | Six live generation/review completions passed the fixed synthetic mechanical evaluation | Carry the working integration into the candidate; select it as the Cloudflare staging default. Production runtime secret/access remains to be verified. |
| `deepseekv4.1-flash-1017-interactive` | Optional permitted Sarvam override | Current official Sarvam catalog entry; not exercised in the prior synthetic run | Keep optional; do not label tested or switch to it automatically. |

The same router catalog did not list the permitted HF overrides `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` or `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`. They are not current production menu entries and are not proposed as hosted replacements. Do not enable an override without renewed catalog and account checks.

The public catalog request returned 106 model entries. V3.2 listed `deepinfra`, `featherless-ai`, and `venice` with status `live`. The saved catalog-only report under `docs/audits/` records a repeatable check using the new audit CLI; it does not submit an inference request.

## Sarvam evidence already obtained

The private testing Site ran evaluator `sarvam-synthetic-cited-v2` with clinical prompt version `2026-11-28.2` and exact returned model ID `deepseekv4.1-flash-1017` for generation and review.

| Fixed synthetic case | Mechanical result | Elapsed time |
| --- | --- | --- |
| Reported numbers and evidence limits | Passed | 2,272 ms |
| Negation, uncertainty and unknown onset | Passed | 2,263 ms |
| Source disagreement | Passed | 2,926 ms |

The completed run made six completions, took 7,895 ms overall, and reported 7,335 input plus 984 output tokens, totaling 8,319. These are observations from the private testing Site, not production benchmarks. The reviewer used the same checkpoint as the generator and is not an independent clinical reviewer.

## Routing repairs

The candidate fixes the following application defects before interpreting failures as model failures:

- Buddy and Browser choices use the same configured-capability resolver. Missing keys, missing AI bindings, invalid model overrides and disabled checkpoints do not create selectable options.
- Groq-only deployments select their configured Groq model correctly; labels and actual requests honor the same `GROQ_MODEL`.
- Explicit selections pin generation and review without fallback. Automatic routing retains its configured fallback behavior. A selected Browser checkpoint uses deterministic literature planning, preventing an unrelated model call from obscuring the test result.
- Automatic Groq responses receive the same model-identity, refusal, truncation and schema checks as other cited-answer routes.
- Workers native JSON literature plans are parsed and validated correctly.
- `MODEL_DISABLED_MODELS` is a comma-separated list of exact checkpoint IDs. It applies to answer choices, automatic routes, reviewers, planners and fallback. Unknown unrelated strings do not disable a different checkpoint.

The candidate Wrangler configuration disables the two current production R1 answer IDs at the top level, in persistent staging and in branch Previews. It preserves the production provider setting and production database. A production change occurs only when the reviewed candidate is deployed there.

## Repeatable operator checks

Run from `healthbrowse/` with the intended environment supplied through the existing secret manager. The CLI does not download Cloudflare secrets or discover the production runtime automatically.

```sh
# Inventory only; no network calls.
node scripts/audit-models.mjs

# One fixed catalog GET; no inference.
node scripts/audit-models.mjs --live --hf-catalog

# Opt-in fixed synthetic completions for configured checkpoints.
node scripts/audit-models.mjs --live
```

Inference is bounded to one request per unique endpoint/checkpoint, at most 12 requests, 512 output tokens per request, and a timeout per request. It has no retries or model fallback and accepts no patient case input. Reports omit credentials, raw provider bodies and endpoint URLs. Exact reported identity is required for OpenAI-style replies; a legitimate HF alias is recorded as a mismatch for review, not as retirement.

A local process has no native Cloudflare `AI.run` binding. Those routes are `not_testable`, not failed. Use `runModelAudit` with the actual binding inside an appropriately authenticated operator environment, or test the exact checkpoint through the signed-in application. The arithmetic probe establishes connectivity and format only; run the source-grounded synthetic application cases and inspect the clinical wording before promotion.

Classify results before changing availability: 401/403 concern access, 402 concerns credits, 429 concerns quota/capacity, and timeouts/5xx concern operation. A malformed structured response is an integration failure. Cloudflare's documented retirement code is `5028`; a generic HTTP 410 alone does not establish model retirement.

## Outstanding work before production promotion

Local candidate verification completed: the application build and all **524 JavaScript tests** passed; the dependency audit reported no high or critical advisories; the staging deployment guard passed its fixtures and correctly refuses the deliberately unprovisioned staging database. The Wrangler configuration dry-run succeeded without uploading. These checks do not substitute for the deployed account tests below.

1. Complete Cloudflare account sign-in, create the dedicated staging D1 database, and connect the staging Worker as described in [cloudflare-staging.md](cloudflare-staging.md).
2. Verify staging runtime authentication and provider secrets. A secret set on the private ChatGPT testing Site is not automatically set on a Cloudflare Worker.
3. Run pinned live tests for the retained production account checkpoints and the full staged application flow. Production inference requires an authenticated application session; no such session was available during this audit.
4. Record the tested staging revision and results, then merge the reviewed staging-to-main PR. Do not interpret a catalog entry, configured status, HTTP 200 source-only answer, or fallback success as a passing named-model test.

## Primary references

- [HF router model catalog](https://router.huggingface.co/v1/models) and [HF provider/catalog API documentation](https://huggingface.co/docs/inference-providers/en/hub-api).
- [Cloudflare Gemma 4 model](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Qwen 3.8 model](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/), and [Workers AI error codes](https://developers.cloudflare.com/workers-ai/platform/errors/).
- [Groq production models](https://console.groq.com/docs/models).
- [Sarvam DeepSeek V4.1 Flash and interactive variant](https://docs.sarvam.ai/api/token-factory/models/deepseek-v4.1-flash-1017).

Saved machine-readable evidence: [HF router catalog check](audits/hf-router-2026-11-28.json).
