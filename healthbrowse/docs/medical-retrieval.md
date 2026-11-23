# Medical question retrieval and reading modes

HealthBrowse answers clear medical questions beyond its local topic names. This change expands retrieval; it does not train or fine-tune a model, grant clinical credentials, or establish clinical validation.

## Response contract

| Mode | Browser response |
| --- | --- |
| General | A direct explanation in everyday language, with citations for the facts supplied. |
| Clinicians | Clinical Synthesis, Evidence Breakdown, and Limitations & Contraindications, with inline citations and an explicit explanation of missing evidence. Medical education uses this reading mode. |

The retrieval index can match mechanisms, signs, tests, treatments, and prognosis to the question. For example, an anatomy query starts with normal function. Buddy accepts a follow-up in the selected audience’s language.

## Source collection

- Existing MedlinePlus and selected CDC/NCI source snapshots remain available.
- MedlinePlus keyword web service retrieves actual FullSummary paragraphs from health-topic pages. Only official topic URLs are accepted. Source: MedlinePlus, National Library of Medicine. Licensed A.D.A.M. encyclopedia and ASHP drug monographs are excluded.
- OpenStax Anatomy and Physiology 2e supplies 4,021 foundational educational paragraphs from 198 modules. The collector pins commit b0058a743bdd2cc08196abaaa7d5469970c0d80c (11 March 2026), whose LICENSE and collection metadata declare CC BY 4.0. Current main has different license terms and is not followed. Figures, captions, exercises, solutions and examples are omitted. Every module retains its source hash and original URL; every retrieved paragraph carries its attribution and source revision. Rebuild with `python scripts/collect-education.py`; review licensing before changing the pinned revision.
- Europe PMC retrieves PubMed-indexed abstracts and publication metadata. The DeepSeek literature route searches MED-indexed records and prioritizes guidelines, systematic reviews and trials for both audiences. Non-MED records, preprints and marked retractions are excluded. Indexing does not mean endorsement or clinical certification. Abstracts are labeled as research evidence rather than practice guidelines. They are not exported as a model-training corpus; publisher terms still apply.

MedlinePlus documentation: https://medlineplus.gov/about/developers/webservices/
Reuse policy: https://medlineplus.gov/about/using/usingcontent/
Europe PMC API: https://europepmc.org/RestfulWebService
Pinned educational license: https://github.com/openstax/osbooks-anatomy-physiology/blob/b0058a743bdd2cc08196abaaa7d5469970c0d80c/LICENSE

## Request sequence

1. Screen the original query and supplied conversation context for emergencies, personal identifiers, unsafe procedures, harmful requests and injection attempts. Repeat checks on the server. The reading mode never bypasses the guardrails.
2. Clarify recognized ambiguous shorthand and missing subjects with selectable options and an editable question. A clear unfamiliar term is not rejected merely because it is missing from the local catalog.
3. Verify Supabase identity and enforce per-account request limits before external retrieval. Send public medical keywords to fixed HTTPS source APIs, not the raw personal narrative. Browser query and chat history are never written to retrieval logs.
4. Retrieve bounded source responses with timeouts, no redirects, relevance filtering, source labels and server-assigned citation IDs. Provider counters are shared through D1 and eligible public searches use a bounded cache. A source outage is distinct from an unclear query.
5. Generate the role-specific answer from the passages that address the question. Buddy can retrieve a new medical subject without forcing a browser workspace switch, and continues follow-ups in that conversational subject.
6. Check citations and separately review claim support. Withhold unsupported claims. If the provider fails, keep retrieved excerpts visible with an explicit source-only label. This automated check does not guarantee absence of hallucinations or substitute for clinical review.

`RETRIEVAL_LIVE=off` is a deterministic offline test/deployment option. It does not disable the stored source snapshots. Default production behavior enables live retrieval. No credentials are needed for the two public source APIs.

## Verification limits

Regression tests exercise both reading modes, normal anatomy, ambiguous and incomplete questions, privacy/safety screening before network access, source restrictions, unrelated-topic isolation, citation IDs, source failure, provider failure, and clinical report structure. Provider/auth responses in integration tests are simulated. A successful build or test is not an independent clinical evaluation or proof of every possible medical query. The UI's managed preview may be unavailable for this Worker configuration; that limitation must be reported separately.
