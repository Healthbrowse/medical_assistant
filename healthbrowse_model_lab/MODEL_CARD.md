# HealthBrowse-Med-Research — candidate model card

- Status: implementation prepared; **no new trained adapter in this repository**.
- Method: QLoRA adaptation, not foundation-model training from random initialization.
- Base: Meta-Llama-3-8B-Instruct, revision `8afb486c1db24fe5011ec46dfbe5b5dccdb575c2`.
- Audiences: General and Clinicians (including medical education).
- Tasks: source-grounded direct explanations, six relevant sections and focused follow-ups.
- Intended use: controlled research and capstone evaluation with public, permitted medical material.
- Excluded use: individual diagnosis/prescribing, autonomous clinical decisions, public patient-facing deployment without validation, or processing patient-identifiable records in this initial implementation.
- Training data: not yet curated. Eight included records are plumbing fixtures only.
- Retrieval data: 4,021 attributed OpenStax textbook passages; not current clinical recommendations.
- Evaluation: draft 100-question set; no measured new-model performance.
- Known limitations: source coverage, lexical retrieval misses, unsupported-but-plausible statements, incomplete safety coverage, citation existence versus entailment, audience adaptation and limited compute.
- Ownership/licensing: new adapters remain subject to the base-model licence and relevant source-data terms. Calling this a HealthBrowse model does not imply ownership of Meta's base weights.
- Deployment: separate research API only; no integration or replacement of the existing browser model.
