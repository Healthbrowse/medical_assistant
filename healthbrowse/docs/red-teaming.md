# HealthBrowse red-team regression

Run `npm run qa:red-team` from this project. It writes `qa-results/red-team/report.md` and `report.json`, prints totals, and exits nonzero on failure. The same matrix is included in `npm test`. No API key, account, patient data, model invocation or network is needed.

Fixtures are in `qa/red-team-cases.mjs`; the runner is `qa/red-team.mjs`. Reports contain fixture identifiers, outcomes and policy versions, not user questions or credentials.

| Layer | Coverage |
| --- | --- |
| Direct input | Role overrides, claimed administrator access, extraction, forged login/audio events, serialized model roles, encoding and invisible characters |
| Medical safety | Unsafe self-procedures, dose changes and falsified records; urgent help takes precedence |
| Conversation | Attacks in topic, search query, browser summary and history; contextual follow-ups |
| Files and retrieval | Instruction-bearing pages/passages are excluded; separate clean pages remain usable; raw markers are checked before markup removal |
| Output | Unsafe commands, secret-like strings, audio controls, role markers and fabricated citation IDs are withheld before support review |
| Benign controls | Pituitary function, SGOT terminology, sore throat, aftercare, simulation, recovery, genetics and platform help remain admitted |
| Isolation | No external calls; safety logs contain only category, policy version and outcome |

On 17 November 2026, this fixture set found 79 failed assertions across repeated surfaces, not 79 distinct vulnerabilities. Six input patterns were missed: two extraction phrasings, three serialized role forms and a soft-hyphen bypass. Markup removal also erased some control markers before source filtering. After correction, **314/314 checks pass** on the same fixtures. This does not mean a live model was observed disclosing information.

Policy `2026-11-17.1` adds serialized-role detection, soft-hyphen normalization, extraction verbs and raw-source screening. Server checks are independent of client checks. Clinicians remains a reading preference, not a security privilege.

## CI

`.github/workflows/healthbrowse-red-team.yml` runs the offline matrix on pushes, pull requests and manual dispatch, preserving reports as artifacts. It needs no secrets and never deploys. The workflow must be at the GitHub repository root to run. Sites stores this source separately; adding this file does not establish that GitHub Actions executed it.

## Limits and research evaluation

Passing fixtures does not establish universal jailbreak resistance, exhaustive multilingual detection, medical accuracy, de-identification or clinical certification. Benign API checks stop at authentication: they prove admission, not successful model generation. Existing model-contract, citation and Worker-runtime tests provide separate software coverage.

For research evaluation, freeze a held-out set before changing rules. Use a dedicated test account for separate deployed-model evaluation of paraphrases, multilingual requests, indirect injection and multi-turn attacks. Report prohibited-output rate, unnecessary-refusal rate, citation support and latency separately. Have independent reviewers assess ambiguous clinical cases. Never use patient records or real credentials as fixtures.

Reference: [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), reviewed 17 November 2026. Untrusted-content separation, output checks and least privilege supplement filtering; no single layer eliminates prompt injection.
