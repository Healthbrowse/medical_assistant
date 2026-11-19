# Capstone delivery schedule

Status: Proposed schedule, not completed work. **Three group members** and a deadline of **7 December 2026 at 12:00 AM San Diego time (PST, UTC−08:00)** are confirmed. This is **7 December 2026 at 1:30 PM IST**, midnight at the start of 7 December in San Diego. Individual owners and the current course module remain to be assigned/confirmed.

As of 17 November, roughly 20 days remain. The original seven-week course budget is 105 hours per member, 315 total; it is not the time still available. At the guideline's 15 hours per member per week, the remaining period represents approximately 129 team-hours. Actual availability and completed work must be reviewed before committing scope.

## Dated remaining-work schedule

Dates below are San Diego calendar dates. These are proposed checkpoints, not completed milestones or guarantees.

| Dates | Priority | Completion evidence |
|---|---|---|
| 17–20 November | Inventory completed work; assign three owners; obtain report template; finalize dataset rights, training question and narrow React/FastAPI scope | Task ownership, baseline commit, reproducible prior results and locked evaluation protocol |
| 21–25 November | Complete one working React/FastAPI search flow and Buddy; clean/label data; freeze grouped splits and run baselines | Runnable flow, source manifest, EDA, leakage checks and baseline outputs |
| 26–29 November | Train compact reranker and tune on validation only; integrate the selected checkpoint if evaluation supports it | Training logs, checkpoint hashes, reproducible configuration and comparison results |
| 30 November–3 December | Run the locked test set, source-support/error review and staging/mobile/authentication tests; draft results | Metrics, plots, limitations, working deployment and draft report |
| 4–5 December | Freeze submission code and results; export notebook PDFs; finalize report, slides and recorded demo | Reproducible submission tag, complete code/PDF bundle, report and video |
| 6 December | Check access, links, file completeness and video; submit with a buffer | Canvas submission receipts and individual peer evaluations |

Suggested internal submission target: **6 December at 12:00 PM PST**, equivalent to **7 December at 1:30 AM IST**, twelve hours before the deadline. This is a proposed buffer, not a changed official deadline.

If work slips, reduce optional UI and commercial features before reducing data integrity, the required model-training evidence or held-out evaluation. Reassess the provisional 600-question annotation target after the pilot; record any scope change before freezing the benchmark. Preserve completed prior experiments as prior work rather than relabeling them as new capstone results.

## Three-member responsibilities

Assign one primary owner each for (1) data and labeling, (2) training and evaluation, and (3) React/FastAPI integration and deployment. All three contribute to source review, the report and the presentation; cross-review each other's work. Names are not assigned automatically from the earlier roster.

## Original seven-week course milestones

| Week | Course milestone | HealthBrowse work | Reviewable output |
|---|---|---|---|
| 1 | Team, topic, dataset and introduction | Confirm new contribution versus AAI-540, research question, scope, data rights and annotation pilot | Introduction, source list, baseline commit and ownership plan |
| 2 | Project management plan | Define React/FastAPI contracts; build one complete search flow; freeze experiment protocol | Plan, API contract, runnable vertical slice and acceptance cases |
| 3 | Cleaning, EDA and dataset summary | Collect/clean permitted sources, annotate queries, group splits and document gaps | Dataset manifest, data dictionary, cleaning code, EDA plots and split checks |
| 4 | Methods/tools and background | Complete lexical/dense/pretrained baselines; integrate Buddy and account behavior | Background draft, baseline metrics, working frontend/API contract tests |
| 5 | Begin training/system work; methods draft | Fine-tune reranker, tune on validation, record seeds and resource use | Training logs, checkpoint manifest, optimization table and methods draft |
| 6 | Complete training/system work; begin results | Locked test evaluation, source-support review, error analysis, staging/load tests | Results, charts, complete prototype, latency/cost report and launch limitations |
| 7 | Report, repository, presentation and peer review | Clean/tag submission, reproduce setup, export notebooks to PDF, record demonstration | Final report, source/PDF bundle, repository URL, PowerPoint, video URL and peer forms |

Schedule an instructor discussion during weeks 3–5 as recommended by the guidelines. Finish initial annotation/scoping early so model training is not displaced by interface work.

## Effort allocation

Planning allocation per person: 25 hours data/annotation, 20 model training and evaluation, 20 application integration, 10 deployment and testing, 25 writing/presentation and 5 contingency. This is the full-course reference allocation, not a remaining-work estimate. Assign shared responsibilities after confirming the names; this allocation is not a record of hours worked. Reduce optional features if annotation or training exceeds the budget.

The capstone minimum is one working React/FastAPI medical question workflow, six source-supported sections, Buddy follow-ups, existing authentication integration, one trained neural reranker and an honest controlled evaluation. Advanced imaging, automatic diagnosis, specialty licensing, native app-store releases, subscriptions and Kubernetes operations remain outside this seven-week minimum.

## Product acceptance and launch boundaries

Before a public pilot, demonstrate that a clear question receives a direct answer or a specific evidence/provider error; six-section formatting must not replace answering the actual question. Include “main function of the pituitary gland,” “type 1 versus type 2 diabetes,” a symptom question, an ambiguous abbreviation, an unsafe DIY-procedure request and a Buddy topic change. Review citations against the exact stored passage.

Exercise Google sign-in, verified email signup/login, password recovery, logout, two-account isolation, bookmark/history CRUD and deletion using test accounts. Verify mobile keyboard behavior, touch targets, themes and visible loading/error states. Test provider throttling, timeouts and dependency failures with a bounded retry budget. Software tests are separate from model-quality measurements.

For the capstone, deploy a staged educational research prototype on Cloud Run. For a commercial release, require clinical review appropriate to the product claims, source/model licensing review, tested retention/deletion rules, security and operational ownership, a cost model and applicable regulatory/privacy assessment. Do not describe prototype outputs as board-certified, hallucination-free or diagnostically validated.

## Final submission checklist

- Confirm instructor access to the submitted repository and a clean, immutable submission tag.
- Include documented working code for cleaning, EDA, pipeline construction, training, optimization and analysis; describe each submitted file and how to reproduce results.
- Include the actual trained-model configuration and artifact access instructions without credentials.
- Include PDF exports of every submitted notebook and the raw Python source files.
- Apply the separate course Report Template once supplied; keep the three-member report within **20 pages including references and figures**, excluding appendices.
- Prepare **at least eight presentation visualizations**: pipeline, corpus composition, split/coverage, retrieval comparison, training curves, support/error analysis, latency and example outputs are candidates for a three-person team. Use actual measured data rather than invented charts.
- Record each member speaking at least two minutes; resolve the under-10 versus up-to-12-minute conflict with the instructor.
- Submit the repository/report/presentation through the course process and complete individual peer evaluations for group work.
- Preserve attribution for prior AAI-540 work and make the new contribution explicit. Confirm the member names and code license before final publication; team size and deadline are recorded above.
