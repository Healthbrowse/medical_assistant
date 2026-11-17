# Dataset preparation

This is supervised adaptation, not pretraining on a pile of PDFs. The retrieval corpus and supervised targets serve different purposes.

## A record

Use the JSON shape in `data/examples/train.jsonl`. Every record has:

- `id`: unique across all splits.
- `topic_group`: a stable concept-family identifier shared by paraphrases and both personas.
- `input`: question, role (`general` or `clinician`), mode (`search` or `chat`), topic_kind (`knowledge` or `condition`), evidence and optional prior questions.
- `target`: a direct cited answer and six ordered decks for search, or a focused cited answer with no decks for chat. Other statuses are clarify, refuse and insufficient_evidence.
- `rights`: one record per evidence ID, naming the licence, the permission basis URL, attribution and whether training is permitted. Do not set permission to true merely because a page is readable online.
- `review`: status, accountable reviewer and `claim_support_checked`. Reviewer identifiers should be stable internal pseudonyms, not personal contact details.
- `example_only`: true for the included fixtures; false only for genuinely reviewed training records.

For actual training, `review.status` must be `approved`, `review.reviewer` must be populated, and `review.claim_support_checked` must be true. Those fields record a review; they do not perform one or certify clinical safety. Both audiences need purpose-written answers. Copying the same paragraph and changing the role label does not teach persona adaptation.

## Curation workflow

1. Select material with documented retrieval and training permissions. Preserve the dated original, URL, attribution and source hash. Exclude personal records and restricted clinical datasets from this initial project.
2. Write questions that a user would actually ask, including anatomy/function, symptoms, comparisons, mechanisms and follow-ups. Include misspellings and natural wording.
3. Write the direct answer before six sections. Explain terminology for General; preserve mechanism, context and qualifications for Clinicians. Do not force treatment onto normal biological structures.
4. Attach exact supporting quotes to each claim. Check the **entire** claim against the quote, including causal statements, population, negation and numbers. A quote existing in a document does not prove it supports the claim.
5. Include useful evidence-gap and clarification examples. Balance safe education with genuinely unsafe requests; avoid teaching blanket refusal of all personal symptom questions.
6. Group all audience variants, paraphrases and multi-turn examples together. Split by topic family and canonical publisher page. Keep duplicate passages together, even when mirrored at another URL.
7. Run `hb-model validate`. Then run tokenizer-length checks through training preflight on a GPU runtime. Overlength records fail instead of losing their evidence or targets.

The validator catches exact ID, normalized question, topic-family, canonical page and passage overlap across train/validation. It cannot detect every semantic paraphrase or incorrect topic label. Review those manually and freeze a separate test split before training. Do not use the evaluation questions to generate supervised training targets.

## Sources

`data/education-corpus.jsonl.gz` is a **retrieval** snapshot derived from the previously collected OpenStax Anatomy and Physiology 2e snapshot at revision `b0058a743bdd2cc08196abaaa7d5469970c0d80c`. Attribution, module hashes and the full CC BY 4.0 text are retained. The derived corpus checksum is in `corpus-manifest.json`. The source export checksum identifies the input to this transformation. It is not a medical guideline database.

MedQuAD, PubMed abstracts, PMC articles, MedDialog and other collections need their own source-level licence and quality review before being added as training data. An index listing or a model-generated answer is not sufficient permission or a verified target. Credentialed clinical datasets are outside this first version.

The included eight exact-excerpt examples are deliberately small and labeled as fixtures. They are for a one-step GPU smoke test only. This project does not claim that a reviewed training dataset has already been collected.
