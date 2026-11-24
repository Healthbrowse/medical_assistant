# Evidence resources and document questions

## Product behavior

Open Buddy and use the plus (+) button in the message composer to attach a PDF with selectable text, PowerPoint presentation (.pptx), Word document (.docx), plain text, Markdown, CSV or TSV. The main browser searches public sources. Buddy can review up to three files, each up to 10 MB, with a total limit of 100,000 reviewed characters and a limit of 60,000 per file. PDFs and presentations support up to 80 pages or slides. Scans require OCR before upload.

Review and edit the extracted material before attaching it. Text extraction runs on the device. For a CSV or TSV, Buddy prepares a local profile of the data, including row counts, missing values, inconsistent row widths and duplicates. Only the aggregate profile is available to attach. Table values and header names stay on the device.

When you ask about an attachment, HealthBrowse sends the reviewed text to its authenticated document endpoint and selects relevant passages for the configured AI provider. Sharing requires authorization for that provider. Remove patient records, credentials and other sensitive information. Provider retention follows the provider’s agreement. Files stay in tab memory and document chats are excluded from saved account history.

Buddy cites the original PDF page, PowerPoint slide or text section. For a SOX deck, ask which control the document describes and which passage records a test result or exception. Missing documentation is an evidence gap. A control description by itself cannot establish that the control operated effectively. Uploaded passages are treated as untrusted evidence and never used as public search queries.

## Reviewed resources and decisions

| Resource | Suitable use | Decision |
| --- | --- | --- |
| [Europe PMC REST API](https://europepmc.org/RestfulWebService) | Live search, abstracts, eligible JATS full text | Extended existing retrieval. At most two eligible OA articles per query; sequential, bounded requests; preserve metadata, license, section and retrieval date. |
| [PMC OAI-PMH](https://pmc.ncbi.nlm.nih.gov/tools/oai/) | Incremental offline harvesting | Added a resumable CLI, not a user-query search endpoint or scheduled production job. Metadata is broader than reusable full text. |
| [EvidenceMD](https://evidencemd.ai/blogs/evidence-search-api) | Optional answer-and-citation API | Vendor page lists limited free credits and per-request charges. Not activated; requires separate credentials and budget. Resolve and review its cited originals before accepting claims. |
| [MedDialog paper](https://aclanthology.org/2020.emnlp-main.743/) | Dialogue evaluation / later instruction tuning | Published English release: approximately 0.26 million conversations across 96 specialties, not 96 diseases. Confirm dataset release and reuse rights, remove identifiers, deduplicate and clinically review before training. |
| [AI Medical Chatbot](https://huggingface.co/datasets/ruslanmv/ai-medical-chatbot) | Candidate question diversity and conversational evaluation | Card shows about 257,000 rows. No clear reuse license was found on the reviewed card. Excluded from automatic training and medical grounding pending rights/provenance and quality review. |
| [MIMIC-IV-Note 2.2](https://physionet.org/content/mimic-iv-note/2.2/) | Controlled clinical summarization / extraction research | 331,794 discharge summaries and 2,321,355 radiology reports. Requires credentialing, training and DUA. Not included in public RAG or sent to outside model services. |
| [HealthData.gov](https://healthdata.gov/) | Discover population-health datasets | Per-dataset provenance, license, geography and statistical methods need review. No unverified catalogue-size claim is used. |
| [Iguazio directory](https://www.iguazio.com/blog/top-22-free-healthcare-datasets-for-machine-learning/) | Find candidate datasets | Directory only; original publisher governs permission and methodology. Not used as medical evidence. |
| [OpenBioLLM-8B model card](https://huggingface.co/aaditya/Llama3-OpenBioLLM-8B) | Offline model comparison | Llama license applies. Model card advises research use and cautions against clinical deployment. No provider/model switch made. |

The supplied Google redirect for the generic GitHub “Medical RAG Chatbot Blueprint” did not resolve to an identifiable repository. No unverified reference implementation was imported. The repeated EvidenceMD link is one resource.

## PMC harvesting

```sh
node scripts/harvest-pmc.mjs --from 2026-11-01 --until 2026-11-07 --output /absolute/research/corpus.jsonl --max-pages 5
# Resume a partial run with exactly the same date window:
node scripts/harvest-pmc.mjs --from 2026-11-01 --until 2026-11-07 --output /absolute/research/corpus.jsonl --max-pages 5 --resume
```

The tool uses `https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/`, `set=pmc-open`, `metadataPrefix=pmc`, and opaque resumption tokens. Requests are sequential with a minimum 400 ms gap, below the documented 3 rps cap. Run only one harvester at a time. For more than 100 requests use off-peak hours (outside weekdays 05:00–21:00 US Eastern). Respect source Retry-After guidance on manual retry. A checkpoint makes retries resumable; downstream ingestion must deduplicate by PMCID and datestamp, process deletion tombstones, and re-check corrections/retractions before admission. CC BY and CC0 pass the current conservative content filter; absent, NC, ND and SA licenses do not. Retained records remain `review_required`, not certified or automatically training-ready.

## Training and evaluation next

Keep live evidence, instruction-training examples and held-out evaluation sets separate. Split by article and topic, not only random QA row; deduplicate near-identical dialogues and prevent benchmark leakage. Train conversational behavior and persona style with licensed, reviewed examples. Retain current facts in retrieval rather than relying on fine-tuned memory. Compare the current model, an untuned lightweight baseline and any proposed QLoRA adapter on the same frozen evaluation set. Measure actual-question coverage, citation correctness, claim entailment, missing-evidence handling, unsafe-request handling, bias, latency and cost. Include uploaded documents with contradictory statements, absent answers, prompt injections, sparse PDFs, missing pages and cross-document questions.

## Implementation references

- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/) and [API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [fflate](https://github.com/101arrowz/fflate) — bounded extraction of Word text, PowerPoint slide text and presentation ordering metadata.
- [Europe PMC copyright and reuse](https://europepmc.org/Copyright)
- [PMC OAI-PMH access and rate rules](https://pmc.ncbi.nlm.nih.gov/tools/oai/)

No claim is made that all linked datasets are integrated, that a model was retrained, or that sourced answers are clinically certified.
