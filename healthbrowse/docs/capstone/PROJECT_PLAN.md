# Seven-week capstone project plan

Status: Proposed schedule, not completed work. Calendar dates and individual owners await the confirmed team and course dates. The supplied guidelines budget 15 hours per person per week for seven weeks: 105 hours each, or 315 hours if the earlier three-person team continues.

## Milestones

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

Planning allocation per person: 25 hours data/annotation, 20 model training and evaluation, 20 application integration, 10 deployment and testing, 25 writing/presentation and 5 contingency. Assign shared responsibilities explicitly after confirming the roster; this allocation is not a record of hours worked. Reduce optional features if annotation or training exceeds the budget.

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
- Apply the separate course Report Template once supplied; respect the team-size page cap including references and figures.
- Prepare the required minimum visualizations: pipeline, corpus composition, split/coverage, retrieval comparison, training curves, support/error analysis, latency and example outputs are candidates for a three-person team. Use actual measured data rather than invented charts.
- Record each member speaking at least two minutes; resolve the under-10 versus up-to-12-minute conflict with the instructor.
- Submit the repository/report/presentation through the course process and complete individual peer evaluations for group work.
- Preserve attribution for prior AAI-540 work and make the new contribution explicit. Confirm the roster, dates and code license before final publication.
