# Medical retrieval experiment and data plan

Status: Proposed AAI-590 experiment; no new training or evaluation results are claimed. Date: 17 November 2026.

## Research question

Does fine-tuning a compact neural cross-encoder on reviewed medical query–passage relevance pairs improve retrieval and source-supported answers compared with lexical retrieval and an unchanged pretrained reranker?

Primary hypothesis: the trained reranker improves held-out nDCG@10 over the same candidate pool with an unchanged reranker. Secondary questions concern direct-answer completeness, citation support, appropriate abstention, persona readability, latency and cost. React/FastAPI deployment demonstrates the ML system; it is not itself evidence that medical responses improve.

## Existing data and model inventory

| Resource | Observed scope | Current use and limitation |
|---|---|---|
| MedlinePlus topic snapshot | 1,017 topics and 5,752 indexed blocks, 5 November 2026 | Topic lookup and source summaries; not complete clinical guideline coverage |
| Selected clinical passage collection | 110 blocks across 21 named topics | Historical selected passages with provenance; not the entire MedQuAD dataset |
| Targeted CDC/NCI evidence | 11 passages | Narrow supplementary evidence |
| OpenStax Anatomy and Physiology 2e | 4,021 paragraphs from 198 modules | Pinned 11 March 2026 revision under CC BY 4.0; attribution retained |
| MedlinePlus and Europe PMC live adapters | Query-dependent results | Live retrieval; returned abstracts are not automatically licensed as a training dataset |
| Earlier MedQuAD research | Historical README reports 16,359 cleaned QA pairs and 38,544 passages | Separate research pipeline; counts must be reproduced before adoption into the new corpus |

These collections overlap; do not sum their counts as unique examples. The full upstream MedQuAD dataset is not the same as the selected browser index. PubMed indexing is not medical certification. Source-specific terms apply to text, datasets, figures and model training.

The current hosted generator is Groq's **openai/gpt-oss-120b**. Reading modes use different instructions, not separately fine-tuned models. A separate request to the same model checks support. Historical experiments include FLAN-T5, MedGemma feasibility and a Llama 3 8B QLoRA adapter. None proves that those models are deployed in the current browser.

The recorded QLoRA split was **182 training / 21 validation / 25 test examples**. In the small grounded-v2 evaluation, both base and adapter had **0/5 accepted browser answers**; accepted Buddy drafts were unfinished. The reviewer falsely accepted **2/5 negative controls**. These are small selected-case findings, not general medical accuracy. Preserve them as prior research and motivation for a stronger benchmark: [artifact manifest](../../inference/releases/llama3-general-research-002.json), [evaluation](../../inference/releases/llama3-general-research-002-grounded-v2-evaluation.md).

## Collection and cleaning

1. Build a source allowlist with rights for each intended use: display, redistribution and training. Prefer public/licensed foundational and medical education material. Exclude patient records, visitor chats, copyrighted third-party drug monographs without permission and unreviewed web scraping.
2. Save an immutable manifest of source URLs, versions, dates, hashes, licenses, parser version and exclusions. Retain the original document boundaries.
3. Remove navigation and broken content, normalize markup/encoding and deduplicate at document and passage level. Preserve units, numbers, negation, age, population and subtype qualifiers. Do not lowercase away meaningful distinctions without retaining original text.
4. Produce EDA: source composition, topic/intent distribution, passage lengths, missing provenance, duplicates, date distribution and coverage gaps. Record counts after every filtering step.
5. Create reviewed relevance pairs spanning normal anatomy, symptoms, diseases, comparisons and follow-ups. Include difficult irrelevant passages about neighboring organs, subtypes or populations. Generated labels are proposals for review, not ground truth.

## Proposed data dictionary

| Field | Type | Meaning |
|---|---|---|
| query_id | string | Stable question identifier |
| query_text | string | Public research question with no personal identifiers |
| audience | enum | general, medical_education or clinician |
| intent | enum | Definition, function, mechanism, comparison, assessment, management or other reviewed type |
| passage_id | string | Stable passage identifier |
| passage_text | string | Exact approved text used for scoring |
| document_id | string | Original source document identity |
| publisher and source_url | strings | Provenance and retrievable reference |
| source_revision and retrieved_at | strings | Immutable revision and collection timestamp |
| license and content_sha256 | strings | Permitted use and content integrity |
| relevance_grade | integer | 0 irrelevant, 1 partially helpful, 2 directly answers the question |
| annotator_ids and adjudication | structured fields | Review provenance and disagreement resolution |
| split_group and split | strings | Leakage-control group; train, validation or test |

The final dataset summary must report its actual schema, variable count, unique questions/documents/pairs and final split sizes. Those figures do not yet exist for the new experiment.

## Splits and annotation

Provisional scope: 600 distinct reviewed questions, split approximately 70/15/15, with 6–10 candidate passages each (3,600–6,000 judged pairs). This is a planning target, not collected data or a claim of statistical power. Run a 30-question annotation pilot and revise scope against the team's time budget before freezing the protocol.

Group near-duplicate questions and their source documents before assignment; keep all passage chunks and query paraphrases within their assigned partition. For the primary evaluation, keep source-document families separate across training and held-out questions. Test-relevant documents can be in the retrieval corpus at inference time but must not have supplied training labels. Report a separate topic-held-out stress set if feasible. Save the split manifest and run overlap checks before training.

Have two reviewers independently label the held-out set and a training subset; adjudicate disagreement and report agreement. Domain-appropriate reviewers are needed for clinical interpretation. Without qualified clinical assessment, score textual source support and relevance and explicitly limit clinical conclusions. Establish any institution-required human-study review before collecting participant usability data.

## Baselines and training

| Experiment | Change | Purpose |
|---|---|---|
| B0 | BM25 lexical baseline | Establish non-neural retrieval performance |
| B1 | Frozen lexical plus dense retrieval | Measure semantic candidate-retrieval contribution |
| B2 | Same candidates plus unchanged pretrained cross-encoder | Separate pretrained ranking benefits from new training |
| T1 | Same candidates plus fine-tuned cross-encoder | Test the new training contribution |

Start with **cross-encoder/ms-marco-MiniLM-L6-v2** as a compact candidate; pin its exact revision and review its license before the run. Sentence Transformers provides the training framework. Train on query–passage relevance labels with a documented ranking/regression loss; select loss and hyperparameters using validation only. A small predeclared search can vary learning rate and epochs, with early stopping, a compute cap and reproducible seeds. Where affordable, evaluate three training seeds and report variability.

For answer comparisons, hold corpus version, candidate budget, generator model, generation settings and prompt constant. Compare retrieval first, then generation using its retrieved passages. Record provider/model identity and time; a hosted alias can change, so preserve exact outputs and do not promise bitwise reproduction. Training logs must show that model parameters changed, along with before/after checkpoints, hardware, duration and selected configuration.

## Evaluation and interpretation

- **Primary:** nDCG@10 with per-query paired confidence intervals for T1 versus B2.
- **Retrieval:** Recall@10 and MRR@10, including zero-relevance cases and coverage by question type.
- **Answer quality:** direct-answer completeness, unsupported-claim rate, citation precision and citation coverage, independently judged against stored passages. Report denominators and disagreements.
- **Safety:** unsafe-action leakage, appropriate refusal and over-refusal on benign educational questions. Role selection must not bypass safety.
- **System:** p50/p95 latency, timeout/error rate, token usage and cost per successful answer; mobile task completion and auth/account isolation separately.

Freeze the test set before optimization. Do not repeatedly tune against failed test cases and still call the result held out. Report negative results, confidence intervals, source bias, label uncertainty and subgroup limitations. Automatic QA and an LLM reviewer supplement human review; neither is a clinical certification process. Similarity scores are not probabilities of medical correctness.

Recommended research outputs are a dataset manifest, cleaning and EDA code, training and tuning code, immutable configs, checkpoint manifest/model card, evaluation predictions, metrics with plots and an error-analysis report. Export every submitted notebook to PDF as required by the course. Model weights belong in an appropriate artifact store, with reproducible access instructions and hashes rather than secrets or oversized binaries in Git.

## References

- Course requirements: supplied AAI-590 Capstone Project Guidelines, pp. 2–4.
- Training API: https://sbert.net/docs/cross_encoder/training_overview.html
- MedQuAD authors and source terms: https://github.com/abachaa/MedQuAD
- MedQuAD paper: https://doi.org/10.1186/s12859-019-3119-4
- MedlinePlus reuse policy: https://medlineplus.gov/about/using/usingcontent/
- OpenStax pinned license: https://github.com/openstax/osbooks-anatomy-physiology/blob/b0058a743bdd2cc08196abaaa7d5469970c0d80c/LICENSE
- Current collection details: [medical retrieval](../medical-retrieval.md)
