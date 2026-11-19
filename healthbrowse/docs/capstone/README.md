# HealthBrowse AAI-590 capstone plan

Status: Active planning; React/FastAPI migration and new reranker training are not yet implemented. Reviewed 17 November 2026 against the supplied **AAI-590 Capstone Project Guidelines.pdf** and **Instruction-README_GitHub-AAI (12).docx**. These are planning documents, not a completed capstone submission.

HealthBrowse will investigate whether training a medical-passage reranker improves the relevance and source support of answers to natural-language medical questions. The application will use React for its interface and FastAPI for the backend. The research contribution is the dataset preparation, trained neural model, controlled evaluation and error analysis; changing frameworks alone does not establish that contribution.

Read the [architecture and migration plan](ARCHITECTURE.md), [experiment protocol and data dictionary](EXPERIMENT_PLAN.md), and [seven-week project plan](PROJECT_PLAN.md). [Repository setup](../../../setup.md) distinguishes the runnable existing application from the proposed replacement.

## Requirements and evidence

| Course requirement | Source | Planned submission evidence | Present status |
|---|---|---|---|
| Original applied ML work with sufficient complexity | Guidelines pp. 1–2 | Prior-work declaration, new retrieval experiment and deployed demonstration | Earlier repository identifies AAI-540 work; new contribution must be explicitly separated |
| At least one neural network/deep learning model and an element of training | p. 2 | Fine-tuned cross-encoder, training logs, configuration, checkpoint hashes and held-out evaluation | Proposed new study; historical Llama QLoRA experiment is documented separately |
| Data cleaning and EDA | pp. 1, 3 | Reproducible cleaning scripts, source manifest, data dictionary, plots and leakage checks | Existing collectors available; capstone dataset and EDA not yet frozen |
| Model/pipeline design, training, optimization, analysis and discussion | p. 3 | Clearly labeled source files/notebooks plus methods and results | New experiment pending |
| Final team report | p. 3 | Report using the separate course Report Template | Report Template not supplied; this plan is not that report |
| GitHub code submission | p. 3 | Public repository or instructor collaborator; documented working code; notebook PDFs and raw Python files | Repository exists; release cleanup and complete file inventory pending |
| Recorded presentation and PowerPoint | pp. 3–4 | Approach, data, tools, training, results, evaluation, pipeline and throughput demonstration | Pending measured results |
| Peer evaluation | p. 4 | Each group member submits the course form | Required for groups, waived for individuals |

The final repository must contain completed working code rather than scratch/nonworking code. Failed experiments can be reported as research findings with reproducible evaluation code; do not label an unusable model as a production component. Preserve historical work in Git history and a clearly identified baseline reference. Prepare a clean submission branch/tag and a per-file inventory; this plan's folder map is not a complete final inventory.

## Confirmed team and deadline

- Team size: **three members**, confirmed by the user on 17 November 2026.
- Deadline: **7 December 2026, 12:00 AM PST**, America/Los_Angeles (UTC−08:00).
- India equivalent: **7 December 2026, 1:30 PM IST** (UTC+05:30).
- Midnight is the start of 7 December in San Diego, not the end of that date.
- Applicable limits: **20 report pages**, **at least eight presentation visualizations**, and **at least two minutes of speaking per member**. Each member submits the group peer-evaluation form.

The corrected December deadline supersedes the initially supplied November date. The [dated schedule](PROJECT_PLAN.md) uses the remaining time; the seven-week course milestones remain a requirements reference.

## Submission limits

| Team size | Report maximum | Minimum presentation visualizations | Detailed presentation duration |
|---|---:|---:|---|
| 1 | 10 pages | 3 | 3–7 minutes |
| 2 | 15 pages | 5 | 5–10 minutes |
| 3 or more | 20 pages | 8 | 8–12 minutes |

Report limits include figures, references and illustrations, but exclude appendices. Each presenter must speak for at least two minutes. The guidelines conflict: p. 3 says **less than 10 minutes**, while p. 4 permits up to 12 minutes for teams of three or more. Confirm with the instructor; provisionally target 8–9.5 minutes for this three-person team. Submit one video URL per team through Canvas. The guidelines place final code and presentation on Day 7 of Module 7; the user-confirmed calendar deadline is 7 December 2026 at 12:00 AM PST.

## README alignment

The supplied README template calls for a title, course statement, status, installation, short objective, contributors, methods, technologies, project description, dataset details, research questions, roadblocks, license and acknowledgments. A separate setup.md is recommended for complicated setup. A partner section applies only if there is an actual partner. The updated root README follows this structure while retaining the earlier technical report for attribution.

Do not invent a project license: the audited root has no LICENSE file. The maintainers must choose a code license and review third-party data/model terms before distribution. University affiliation and citations do not establish clinical certification or endorsement.

## Decisions to finalize

1. Team size is confirmed as three. Confirm the final member names and responsibilities; the existing README lists Abhay Srivastav, Chandra Mouli Mudumba and Rahul Pawar as earlier contributors.
2. Supply the separate course Report Template and confirm the current module; the calendar deadline is now recorded above.
3. Discuss the proposed extension of AAI-540 work with the instructor and document the new AAI-590 contribution. This is an academic scope recommendation, not an approval requirement invented from the guidelines.
4. Assign dataset annotation and clinical-review capacity. If qualified clinical review is unavailable, report that limitation and keep claims limited to source support and retrieval performance.

This planning update changes documentation only. It does not deploy React/FastAPI, train a new model, demonstrate new medical accuracy, or certify the product for clinical use.
