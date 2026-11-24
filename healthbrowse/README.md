# HealthBrowse public research platform

HealthBrowse is an educational research browser with two reading modes. General readers get a plain-language answer. Clinicians get a clinical synthesis with evidence and limitations. Both can ask Buddy a follow-up using the same sources.

**17 November 2026 architecture decision:** React JS frontend and FastAPI backend are the selected migration target. The running browser still uses the JavaScript/Worker implementation below. See the [AAI-590 capstone plan](docs/capstone/README.md), [migration architecture](docs/capstone/ARCHITECTURE.md) and [setup guide](../setup.md). This documentation update does not complete the migration or a new training run.

The DeepSeek profile routes General to `deepseek-ai/DeepSeek-R1-Distill-Llama-8B`, Clinicians to `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`, and medical search planning to `deepseek-ai/DeepSeek-V3.2`. The audience model checks generated claims against the retrieved passages in a second call. The server verifies publication identities, resolves citations and returns source excerpts or evidence gaps when synthesis is unavailable. Model availability depends on the serving provider and account. [Configuration, evidence API and acceptance checks](docs/model-integration.md)

The browser and Buddy show citations alongside answers. The authenticated evidence API exposes the executed searches, verified records and evidence gaps. The independent Llama/QLoRA research lab has its own training and evaluation workflow. [Medical Model Lab notebook](https://github.com/abby2395/medical_chatbot/blob/research/healthbrowse-medical-model/healthbrowse_model_lab/notebooks/HealthBrowse_Medical_Model_Lab.ipynb)

The hosted desk uses Supabase sign-in and stores profile preferences, saved research chats, bookmarks and activity. ClinicalTrials.gov registrations and NIH funding records are available through research discovery.

Historical adapter findings: [original evaluation](inference/releases/llama3-general-research-002-evaluation.md) and [grounded-v2 audit](inference/releases/llama3-general-research-002-grounded-v2-evaluation.md). These failed research evaluations remain preserved; hosted-model checks do not validate those adapters.

## Disease framework and reading modes
Medical search results answer the question directly. General readers see a plain-language summary with inline citations. Clinicians see **Clinical Synthesis**, **Evidence Breakdown**, and **Limitations & Contraindications**. Readers can inspect source passages, open linked publications, and use **Copy answer** to copy the response with its references. The research shelf and Buddy provide further reading and follow-up. [Evidence organization and session behavior](docs/DISEASE_FRAMEWORK.md)

The browser and buddy use the same question-answering and audience profiles:

| Reading mode | Answer behavior |
| --- | --- |
| General | Plain-language answers, explanations of unfamiliar terms and source-supported safety information |
| Clinicians | Clinical terminology, diagnostic and management context, subtype distinctions and evidence limitations |

Only these two modes are selectable. Both use the floating Buddy, which stays closed until clicked. A reading-mode selection changes presentation, not identity verification or access to patient records. Research papers, datasets and care resources remain separately available. The specialty selector is removed.

Conversational phrasing, known synonyms and spelling corrections are normalized before intent matching. Multipart questions receive source-supported answers, with missing evidence identified. Each clinical passage retains its citation and stored-source check.

The MedlinePlus importer now retains complete headed summary blocks, including diagnosis and treatment sections that the previous first-paragraph preview omitted. The 5 November 2026 feed contains 1,017 topics and 5,752 indexed blocks. Original publisher terms, attribution and provenance hashes are retained. Local topic loading and external requests have time limits; an account-history outage cannot block a research answer.

Clinical excerpts require a recognized publisher or a pinned historical MedQuAD record, topic agreement, record identity and an exact text match. Corrections require an explicit, unambiguous source record; otherwise the claim is withheld. These checks detect some unsupported or altered claims, but do not establish clinical accuracy, certification, completeness or currency. Historical excerpts retain their dates and subtype labels. Untreated natural history is not inferred from general progression or treated outcomes. See [framework design and validation](docs/DISEASE_FRAMEWORK.md).

## Document questions and research sources

Open Buddy to attach a PDF, PPTX, DOCX, TXT, Markdown, CSV or TSV file. Review the extracted text or aggregate dataset profile before asking your question. Buddy cites the relevant page, slide or section and flags missing evidence. Attachments stay in tab memory, and document conversations are excluded from account history. Public browser searches run independently of Buddy’s uploads.

Europe PMC retrieval now includes eligible CC BY/CC0 open-access full text. A separate PMC OAI harvester stages licensed records for review. EvidenceMD, dialogue training datasets, restricted clinical notes and candidate models are assessed separately and are not automatically enabled or trained. See [retrieval, attachments, dataset terms and evaluation](docs/retrieval-and-attachments.md).

## Educational visuals and support

Educational searches explain the requested concept in everyday language for General readers and in clinical and educational terms for Clinicians. Buddy can expand on the answer using the cited evidence. Licensed textbook illustrations include original-source links and alt text. The Help menu opens Feedback at `/feedback.html` and Contact us at `/contact.html`. [Educational visuals and support](docs/education-and-support.md)

## Automated response QA

The [dual-persona QA bot](docs/QA_BOT.md) checks both audiences, clinical report sections, Buddy follow-ups, citations, safety handling and response timing. Run `npm run qa:bot -- --limit=4` for the initial four public-example cases.

The [red-team regression](docs/red-teaming.md) runs offline with `npm run qa:red-team` and is included in `npm test`. It covers direct and document-based prompt injection, both reading modes and search/Buddy entry points, unsafe output and benign controls. JSON and Markdown reports distinguish tested application boundaries from unmeasured live-model robustness.

## Run locally
Use Node 24. From this directory:
```sh
npm ci
npm run build
npm test
npm start
```
Open http://localhost:8080. Set the Supabase public configuration to use the signed-in desk. Research APIs need internet access. The leukemia example can display a dated verified snapshot when live retrieval fails. Health checks are at /healthz and /readyz. Open /account.html for authentication, settings, bookmarks, favourites, history, feedback, contact and help. The offline mobile screen asks visitors to reconnect before retrieving current evidence.

## Enable accounts, storage and contact
1. Use Supabase Auth for identities and confirmed email addresses. Sites provisions the `DB` binding and applies the schema in `drizzle/` for profiles, chats, preferences and support requests. See [Workspace storage](docs/WORKSPACE.md). The existing Supabase migrations remain for the research catalog, institutions and legacy support deployment.
2. Configure email confirmation, numeric OTP templates, SMTP, Google OAuth, exact callback URLs and a minimum 12-character password policy. See [account setup](docs/ACCOUNTS.md). Password login and passwordless OTP login are alternate sign-in paths.
3. Configure SUPABASE_URL and SUPABASE_ANON_KEY for authentication. Support submissions save in the Sites database without a mailbox. To enable contact forwarding, additionally configure RESEND_API_KEY, CONTACT_FROM and CONTACT_TO; the legacy Supabase contact deployment also requires SUPABASE_SERVICE_ROLE_KEY. Set CONTACT_TO to a real mailbox owned by your organization. CONTACT_FROM must be authorized by the outbound provider. Google OAuth credentials belong in Supabase, not in the browser.
4. Run acceptance tests with two separate test accounts and a test mailbox before enrolling real users. A provider accepting a message does not prove inbox delivery.

Chat saving is on by default and is disclosed beside the copilot. Users can turn off new saves, reopen or rename chats, delete individual chats, or delete all chats and topic activity. The separate topic activity history is off by default. Avoid entering patient details in search, chat, feedback or contact. A negative sentiment label does not establish that a report is false. Human reviewers investigate corrections against the original medical source.

## Release and operate
- [Docker, Kubernetes and Cloud Run deployment](deploy/README.md)
- [Authorized source refresh and operational monitoring](docs/maintenance.md)
- [Research protocol, business pilot and mobile distribution](docs/research-business.md)

Repository-level workflows run from the parent repository's .github/workflows directory. CI tests, scans and packages the service. A protected production environment and workload identity federation are prerequisites for a Cloud Run deployment. Scheduled refresh creates a reviewable content change; publication requires review. Do not claim that source matching or a passed test provides clinical certification.

## Public access, domain and mobile
Use the supplied hosting URL for a pilot. A custom domain requires registration, DNS control and a verified mapping. A corporate mailbox requires an email provider and MX records. For mobile, install the HTTPS web app through the browser's Add to Home Screen or Install command. Its service worker caches only a generic offline page. An App Store or Play Store release is a later, independently reviewed distribution channel.
