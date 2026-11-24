# Models and biomedical evidence in HealthBrowse

The DeepSeek deployment profile uses three Hugging Face checkpoints. General and Clinicians are the two user roles. Selecting Clinicians also enables medical education content.

| Workload | Default checkpoint | Responsibility |
| --- | --- | --- |
| General search and Buddy | `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` | Plain-language synthesis and support review |
| Clinician search and Buddy | `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` | Clinical synthesis, evidence breakdown, limitations and support review |
| Biomedical literature retrieval | `deepseek-ai/DeepSeek-V3.2` | Select targeted searches from public terms, indexed MeSH headings and relevant clinical modifiers |

## Activate the server profile

Set `MODEL_PROVIDER=deepseek` in the server runtime. Supply `HF_TOKEN` through the runtime secret manager using a fine-grained Hugging Face token with **Make calls to Inference Providers** permission. All three routes use the same token at `https://router.huggingface.co/v1/chat/completions`. Keep real credentials out of Git, browser bundles and logs. [Hugging Face authentication and provider routing](https://huggingface.co/docs/inference-providers/en/index)

| Optional server setting | Accepted alternative to the default |
| --- | --- |
| `DEEPSEEK_GENERAL_MODEL` | `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` |
| `DEEPSEEK_CLINICIAN_MODEL` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B` or `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` |

Overrides select a checkpoint explicitly. The server always requests the configured model ID. A deployment can have all three routes configured and still encounter a provider access, capacity or credit error. See the project’s [environment example](../.env.example) and the [Hugging Face pricing and billing guide](https://huggingface.co/docs/inference-providers/en/pricing).

Use the existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` for authentication. The hosted Site uses its D1 `DB` binding and `hb_model_limits` migration. Standalone deployments should apply the repository’s migrations and configure credentials in the runtime environment. Model inference runs remotely.

## How a medical question becomes a cited answer

1. Search and Buddy screen the question and supplied context for safety and privacy. The server verifies the session and rate limit before retrieval. The planner receives public search terms and matching local MeSH headings. For an eligible personal narrative, the literature search uses a recognized public topic.
2. V3.2 selects up to two additional searches alongside the original public terms. The server builds queries and selects retrieval destinations. If planning is unavailable, it uses deterministic public-keyword searches and records the fallback in the packet.
3. The literature service queries Europe PMC for MED-indexed records, prioritizing guidelines, systematic reviews and trials. It can inspect reference lists, follow cited primary publications and verify the selected publication identities on PubMed. It also checks matching institutional pages from the local source catalog. The budget allows up to four initial index queries, two cited publications to follow, five indexed publication landing pages and two direct institutional pages, subject to an overall network limit and deadline.
4. The audience model receives eligible retrieved passages and applicable local material. A second call to that same model reviews source support. The server checks citation IDs and resolves the reader-facing citations against its own records. Buddy uses the active question and deck as context. Document questions use the user's selected attachment passages and page, slide or section citations.
5. Successful browser synthesis returns the cited answer to the question. General readers see a plain-language explanation. Clinicians see Clinical Synthesis, Evidence Breakdown, and Limitations & Contraindications. A provider failure can return linked source excerpts labeled `source-excerpts-v1`. The report identifies insufficient or conflicting evidence when it affects the question.

## Inspect a literature packet through the API

Readers can open citations alongside their answers. A synthesis response from `POST /api/ai/answer` can also include the packet at `retrieval.evidencePacket`.

For retrieval alone, send a same-origin, authenticated `POST /api/ai/evidence` with a Supabase bearer access token, `Content-Type: application/json`, and a body such as the following.

```json
{
  "topic": "Hypertension",
  "question": "Which studies evaluated exercise for hypertension?",
  "role": "Clinicians"
}
```

| Response field | Contents |
| --- | --- |
| `query_decomposition` | Executed search expressions and attempted follow-up or institutional lookups |
| `retrieved_sources` | Records containing `source_id`, `title`, verified `url`, `publication_year` (nullable), `evidence_tier` and `extracted_findings`. Each finding carries text and a field or section. |
| `evidence_gaps` | Unverified references, missing findings, unavailable sources or planning limitations encountered during this search |

The source tier identifies where the record comes from. Study design, eligibility, reported outcomes and abstract-only coverage determine how a study can be interpreted. The lookup extracts reported findings and preserves their numbers. It also verifies up to two eligible open-access PMC full texts. Body findings retain their original section, license and attribution. A publication date, endpoint or recommendation grade may be absent. Set `RETRIEVAL_LIVE=off` to disable live retrieval in a local test.

## Verify the deployment

Run `npm test` and `npm run build` with Node 24. The automated model-routing and literature-agent tests use controlled provider and source responses. To confirm a deployed credential can perform inference, complete these checks with a signed-in test account.

1. Open `GET /api/ai/status` to check the selected provider, configured routes and model IDs. This endpoint reads configuration.
2. Submit one public educational question in each role. Check the actual answer response for the requested checkpoint, `deepseek-cited-v1` and supported citations. A `source-excerpts-v1` response indicates source fallback.
3. Inspect a packet and open a cited publication. Compare the finding with the source and look for any planner fallback in `evidence_gaps`. Ask a Buddy follow-up and check that the displayed evidence belongs to the current question.

## Research lab and legacy deployments

The independent HealthBrowse Medical Model Lab uses Llama/QLoRA for training, adapter comparisons and blind evaluation. Activating this hosted DeepSeek profile sends inference requests only. The lab notebook and its saved adapters follow a separate release process. [Independent model lab notebook](https://github.com/abby2395/medical_chatbot/blob/research/healthbrowse-medical-model/healthbrowse_model_lab/notebooks/HealthBrowse_Medical_Model_Lab.ipynb)

Operators can select the legacy Groq route explicitly with `MODEL_PROVIDER=groq`, `GROQ_API_KEY` and `GROQ_MODEL`. Existing dedicated endpoints use the `MODEL_GENERAL_*` and `MODEL_PROFESSIONAL_*` settings under the custom profile. The historical `scripts/smoke-groq.mjs` script exercises Groq only.
