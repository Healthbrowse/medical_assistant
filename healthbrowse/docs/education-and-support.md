# Educational explanations and product support

## Educational searches

Only two reading modes exist: General and Clinicians. Knowledge questions retain the subject the visitor actually asked about, rather than replacing an organ or substance with a disease page found through an alias. The normal definition/function comes first. General generation asks for natural, connected everyday language and explains essential terms; Clinicians retains clinical and educational depth. Existing citation resolution and automated claim-support review still apply. These checks are not clinical validation.

Definition retrieval ranks sentences that actually define the requested subject above incidental keyword overlap, including singular/plural forms such as mitochondrion/mitochondria. Provider context budgeting counts the fields actually sent to the model, preserving complete textbook definitions. During provider outages, the immediate answer uses a contiguous, cited definition excerpt instead of the first introduction on a related disease page. A source-only definition can be identical between audiences; it is labeled as an excerpt and does not acquire unrelated diagnosis or treatment paragraphs to simulate clinical depth. Regression tests cover the reported mitochondria query, pituitary, bilirubin, and missing-definition handling.

Educational questions draw on relevant textbook passages about anatomy, mechanism, function or measurement. The browser cites those passages in the answer and marks gaps. Buddy can expand on the same question with additional context.

`dist/education-figures.json` indexes 570 figures from the existing OpenStax Anatomy and Physiology 2e CC BY 4.0 snapshot, commit `b0058a743bdd2cc08196abaaa7d5469970c0d80c`. It is not an ingestion of the current OpenStax website or its newer license. The collector checks every chapter SHA-256 against the licensed text corpus and excludes figures with explicit third-party credits. Each displayed figure has alt text, attribution, original-source and license links. It is an educational aid, not imaging interpretation or additional evidence for model claims.

The image endpoint permits registered image IDs only. It fetches fixed pinned repository paths, rejects redirects, checks the binary signature, enforces a 2 MB limit and times out. No query text, identifiers, credentials or document contents are forwarded. If no suitably relevant figure is available, no unrelated image is substituted; if loading fails, the original-source link remains visible. Figures are not added to uploaded-document answers.

To rebuild the registry: `python scripts/collect-education-figures.py`. An optional `--chapters-dir` accepts already downloaded `.cnxml` chapters but still verifies the hashes. Review the snapshot license and exclusions before changing the revision.

## Feedback and Contact us

The research and account menus link to separate pages at `/feedback.html` and `/contact.html`. Existing bookmarks to either form on `/support.html` open the corresponding page. Forms have labels, validation, counters, pending/error/receipt states and responsive light/dark layouts. Submissions require a Supabase-authenticated user. The server derives ownership from that identity; it does not accept a client-provided owner or email recipient.

Sites applies migration `0005_messy_payback.sql`, creating private `hb_support_requests` records. Feedback categories are suggestions for review, not proof of medical correctness. Source corrections remain pending review. Each user may submit ten new requests per day. Reusing the same request ID and payload returns the receipt, while a changed payload is rejected. Message text is not sent to an LLM and is not logged.

Contact messages are saved even when mail forwarding is unavailable. To forward them, configure `RESEND_API_KEY`, `CONTACT_FROM` (verified sender) and `CONTACT_TO` (team mailbox) in server secrets. Existing credentials were not changed by this feature. Until configured, the visitor sees a saved receipt and a clear email-forwarding notice. Provider success means accepted for sending, not confirmed inbox delivery. Provider retries use a stable idempotency key; requests older than 23 hours are retained without automatically re-sending. Maintainers must review received/pending records through private database administration; no public inbox endpoint is exposed.

Do not place patient data or secrets in these forms. Basic identifier checks reduce accidental submission but do not constitute comprehensive de-identification. The forms are for product support, not urgent care. Support records are separate from chat history.

## Verification

Tests with simulated provider responses exercise both audience routes, educational source selection, citations, image controls, account isolation, submission quotas and email-forwarding behavior. Clinical accuracy requires independent review.


## Personal diagnosis questions (17 November 2026)

Questions such as “Do I have dengue?” now start with diagnostic uncertainty before the educational answer. Search and Buddy share the response formatter, three follow-up questions, and the same provider-unavailable behavior. The dengue response links CDC testing and symptom guidance, asks about duration, associated symptoms and exposure/testing, and clarifies an omitted temperature unit. Urgent warning signs are shown without requiring the user to finish the conversation or wait for laboratory confirmation.

The short dengue explanation is an attributed, curated CDC summary when the model omits basic context or is unavailable. Other personal diagnosis questions receive a limitation and follow-up prompts. The browser answers educational questions in the selected reading mode.

Sources checked: [CDC symptoms and testing](https://www.cdc.gov/dengue/signs-symptoms/) and [CDC clinical testing guidance](https://www.cdc.gov/dengue/hcp/diagnosis-testing/). Tests cover the reported query, both roles, both model output formats, source fallback, leading placement, and rejection of inferred temperature units. A live General generation succeeded; the clinician live test was rate-limited, so its generated quality was not verified in that run.


### Diagnosis follow-up correction (18 November 2026)

The first version required too narrow a confirmation phrase and placed the lead/follow-ups only in new display fields. Common forms including “Is it dengue?” and “Could this be dengue?” now activate the same flow, using the resolved medical topic rather than a disease allowlist. Educational questions such as “How is it treated?” remain educational.

Diagnostic uncertainty, warning signs and follow-up questions are also included in ordinary answer blocks, so older open clients show them when receiving a new response. The current renderer avoids duplicating these blocks. Previously saved answers are not rewritten. Tests exercise browser and Buddy API requests through requestSynthesis in both reading modes, plus renderer ordering and compatibility with clients that consume only blocks.

## Heart visuals in Browser search

Searching for `heart` offers a choice of anatomy, pumping or common conditions. A chamber or valve question opens the corresponding licensed OpenStax figure. Both images ship with the Worker and retain the original labels and image credits. A normal blood-flow question uses the ordinary medical answer and review pipeline. The Browser draws each arrow only when the answer cites the corresponding passage from the pinned Heart Anatomy chapter and that passage contains the supporting relationship. Readers can expand the quoted paragraph beneath the diagram. General labels name organs and chambers. Clinician labels include vessels and capillary beds. When the cited passages support only part of the circulation, the diagram shows those individual connections.

For example, try `heart`, `What are the chambers of the human heart?`, `Where are the heart valves located?` and `How does the heart pump blood?` in each reading mode. A fetal circulation or heart failure question stays on the ordinary medical search path. Run `node --test tests/heart-visual.test.mjs` from the healthbrowse directory to exercise the routing and evidence checks.

The default Browser uses a fixed visual-selection policy. The opt-in [cardiology research pilot](../inference/cardio-policy/README.md) runs a CPU-trained contextual bandit and includes a blinded reviewer workflow. Before testing a learned policy, have independent reviewers label a held-out set of questions for the appropriate action (clarify, illustration, diagram or text), passage support for each arrow, and agreement between text and image. Report results by reading mode, including missing visuals and incorrect arrows. Keep the held-out questions separate from policy development.
