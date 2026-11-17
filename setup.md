# HealthBrowse setup and architecture status

The React frontend and FastAPI main backend are the selected replacement architecture. **They are planned, not implemented by this documentation update.** The commands below run the existing JavaScript browser service. The separate top-level Streamlit/FastAPI project is earlier MedQuAD work and is not the replacement React application.

## Existing browser

Install Node 24 and Git. Clone the repository and choose the documented development branch:

```sh
git clone https://github.com/McChandra/medical_chatbot.git
cd medical_chatbot
git switch feature/responsive-healthbrowse-auth
cd healthbrowse
npm ci
npm run build
npm test
npm start
```

Open http://localhost:8080. The branch is a development reference, not the final capstone release tag. For exact reproduction, check out the commit recorded with your experiment instead of relying on a moving branch.

Use [account configuration](healthbrowse/docs/ACCOUNTS.md), [workspace storage](healthbrowse/docs/WORKSPACE.md) and [model integration](healthbrowse/docs/model-integration.md) for environment requirements. Supabase Auth and a configured model provider are required for their respective online features; installing packages does not enable email delivery or hosted inference. Use an untracked local environment file or secret manager. Never commit a service-role key, model API token or SMTP password.

The hosted Sites deployment uses a D1 binding. Local/standalone persistence has different setup and must not be assumed to share that data. Read the storage documentation before creating accounts or migrating records. The existing Docker and Cloud Run files target the Node application; review [deployment instructions](healthbrowse/deploy/README.md) and the [migration findings](healthbrowse/docs/capstone/ARCHITECTURE.md) before using them outside a local test.

## Research reproduction

Keep model training separate from the web service environment. The historical [QLoRA notebook instructions](healthbrowse/inference/colab-qlora.md), pinned requirements and [release audits](healthbrowse/inference/releases/llama3-general-research-002-grounded-v2-evaluation.md) document the prior experiment. Its adapter did not pass the browser evaluation and is not the current public generator. Do not restart unchanged failed training solely to deploy a model.

The new [reranker experiment](healthbrowse/docs/capstone/EXPERIMENT_PLAN.md) will receive pinned dependencies, download/rights instructions, dataset hashes, training commands and held-out evaluation commands when implemented. No invented commands or empty notebooks are presented as a completed training pipeline here.

## Planned React and FastAPI replacement

See the [architecture](healthbrowse/docs/capstone/ARCHITECTURE.md) for component boundaries and API contracts. The first implementation milestone is an end-to-end React query, FastAPI retrieval/generation and cited answer flow. Add Buddy, accounts and persistence after that flow passes its acceptance cases. Final setup instructions must be verified on a clean machine against the submission tag.
