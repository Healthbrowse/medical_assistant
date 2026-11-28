# Cloudflare staging and production promotion

## Status and deployment boundary

This configuration targets the existing **staging-healthbrowse-ai** Worker at [staging-healthbrowse-ai.abhaysrivastava518.workers.dev](https://staging-healthbrowse-ai.abhaysrivastava518.workers.dev/). It does not provision resources or verify the live deployment's bindings and credentials. The tracked `env.staging.d1_databases` array is intentionally empty. The staging commands refuse to run until an operator inserts the actual ID of a dedicated **healthbrowse-staging** D1 database. No production database, existing preview database, credentials, or invented resource IDs are copied into staging.

Use one GitHub repository, **Healthbrowse/medical_assistant**, with a persistent **staging** branch and the separate **staging-healthbrowse-ai** Worker. Production remains the existing top-level **healthbrowse-ai** Worker connected to **main**. The configuration matches the existing staging Worker; no external Worker rename is needed. Do not create an `env.production` merely for symmetry: that would change the target name unless separately configured.

Cloudflare's [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/) create persistent Workers. [Worker Previews](https://developers.cloudflare.com/workers/previews/compare-workflows/) create branch environments under a Worker. This guide uses the persistent staging Worker first; it does not switch the existing production Worker's preview model.

| Setting | Staging | Production |
| --- | --- | --- |
| Repository | `Healthbrowse/medical_assistant` | Same repository |
| Git branch in Workers Builds | `staging` | `main` |
| Worker | `staging-healthbrowse-ai` | Existing `healthbrowse-ai` |
| Root directory | `healthbrowse` | `healthbrowse` |
| Build command | `npm ci && npm run build && npm test` | Same verification command |
| Deploy command | `npm run deploy:staging` | Existing `npx wrangler deploy` |
| Database | New, dedicated `healthbrowse-staging` | Existing `healthbrowse-db` |
| Runtime provider | `sarvam` / `deepseekv4.1-flash-1017` | Retain current setting until the reviewed promotion decision |

Staging uses the separately hosted Flash checkpoint. It is not an alias for the earlier DeepSeek R1 distill or V3.2 checkpoints. Its configured `AI` binding is explicit; that binding does not change the selected Sarvam default or establish model availability.

`MODEL_DISABLED_MODELS` excludes `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` and `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` at the top level, in staging, and in existing Previews. These exact IDs were absent from the Hugging Face router catalog checked on 28 November 2026. This records observed serving availability, not global model retirement. The production configuration still does not set `MODEL_PROVIDER`; `keep_vars: true` retains the existing dashboard-managed default. Re-enabling a route requires checking its actual serving availability and responses.

## 1. Prepare and verify the staging branch

Create `staging` from the reviewed candidate revision in the same repository. Record the exact candidate commit in the PR. The configuration itself does not create a branch or merge a PR.

Use Node 24. From `healthbrowse/`:

```sh
npm ci
npm run build
npm test
npm audit --audit-level=high
```

Wrangler is pinned to **4.169.0** in `package.json` and the lockfile. The deployment wrapper invokes that local installation and refuses a version mismatch; it does not download a different CLI during deployment. Current [Worker Previews setup](https://developers.cloudflare.com/workers/previews/get-started/) requires Wrangler 4.135.0 or later.

## 2. Provision a dedicated staging database

Sign in to the intended Cloudflare account, or supply its authorized deployment token through the local/CI secret manager. Confirm the account before creating a resource. Run this explicit setup command from `healthbrowse/`:

```sh
npx --no-install wrangler d1 create healthbrowse-staging --env staging
```

If Cloudflare reports that the database already exists, inspect that database and its ownership/use before continuing. Do not replace it with `healthbrowse-db` or `healthbrowse-preview`, and do not rerun creation expecting an independent copy.

Copy the newly returned D1 binding into **`env.staging.d1_databases`** in `wrangler.jsonc`. Set:

- `binding` to `DB`.
- `database_name` to `healthbrowse-staging`.
- `database_id` to the exact UUID returned by Cloudflare.
- `migrations_dir` to `drizzle`.

Leave the top-level production and existing `previews` bindings unchanged. Keep the file valid JSON; the staging guard parses data without evaluating configuration code. Commit the real resource configuration for review. Database IDs are configuration identifiers; provider keys and authentication credentials do not belong in the file.

Then check the target and migration state:

```sh
npm run staging:check
npm run db:staging:list
npm run db:staging:migrate
```

The migration scripts internally use `healthbrowse-staging --remote --config wrangler.jsonc --env staging`. They reject a production or existing-preview database ID. For an existing database, inspect its schema and applied migration state before applying changes; do not mark migrations applied merely to silence an error. Cloudflare documents [migration directory and tracking behavior](https://developers.cloudflare.com/d1/reference/migrations/). This repository's SQL migrations live in `drizzle/`, not Wrangler's default `migrations/` directory.

## 3. Deploy reviewed staging code and configure runtime secrets

With the actual dedicated database configured and migrations applied:

```sh
npm run deploy:staging
```

The wrapper constructs `wrangler deploy --config wrangler.jsonc --env staging`. It accepts no extra flags and rejects a `WRANGLER_CI_OVERRIDE_NAME` targeting any Worker other than **staging-healthbrowse-ai**. Inspect the existing staging Worker's bindings before deploying. Authentication and model calls remain unavailable until their runtime configuration is supplied.

Set staging runtime values through interactive secret input, not command arguments or committed files:

```sh
npx --no-install wrangler secret put SARVAM_API_KEY --env staging
npx --no-install wrangler secret put SUPABASE_URL --env staging
npx --no-install wrangler secret put SUPABASE_ANON_KEY --env staging
```

In the dashboard, set these values in **Variables and Secrets for the existing staging-healthbrowse-ai Worker**. Values entered only under **Builds → Build variables/secrets** are available during the build and are not automatically supplied to the running Worker. This app reads its authentication configuration from the request-time Worker `env`; its build scripts do not embed these values. A key stored in the private ChatGPT testing Site or another Worker is not automatically present here. Ensure the runtime changes are active before rechecking sign-in.

Use the exact variable names below, with values from the intended staging authentication project:

| Runtime name | Accepted value |
| --- | --- |
| `SUPABASE_URL` | The HTTPS project origin, such as `https://<project-ref>.supabase.co`, with no `/auth/v1`, `/rest/v1`, dashboard path, query, fragment, or embedded credentials. |
| `SUPABASE_ANON_KEY` | The project's public `sb_publishable_…` key, or a legacy anon JWT whose payload has `role: "anon"`. Keep this variable name even when using a publishable key. |
| `SARVAM_API_KEY` | The staging Sarvam credential. This is independent of account setup. |

`SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*` are not read by this application. Paste raw key values without surrounding quotes or leading whitespace. The browser bootstrap deliberately rejects `sb_secret_…` and legacy `service_role` keys; do not use them as `SUPABASE_ANON_KEY`. The validated project URL and public key are returned to the browser through `/api/config`.

Allow the app's exact staging callback URLs in the staging authentication project's redirect URL configuration:

- `https://staging-healthbrowse-ai.abhaysrivastava518.workers.dev/account.html`
- `https://staging-healthbrowse-ai.abhaysrivastava518.workers.dev/account.html?flow=recovery`

Check [the staging `/api/config` endpoint](https://staging-healthbrowse-ai.abhaysrivastava518.workers.dev/api/config) before attempting sign-in. It should return nonempty `supabaseUrl` and `supabaseAnonKey` fields. Empty fields mean the runtime values are missing or failed the public-config validation; HTTP 200 alone does not establish account readiness. The account page's setup error can also result from a non-success response from this endpoint, so check its HTTP status before assuming credentials are missing. A valid-looking public key does not prove that it belongs to the configured project, so complete a staging sign-in after fixing the bootstrap. `/healthz` and `/readyz` check service/assets, not authentication or database configuration.

Protect staging with Cloudflare Access before sharing private test content. Use synthetic cases and test accounts. Do not import production account data, patient material or outbound email credentials to make a smoke test pass.

## 4. Connect the staging Worker to GitHub

In Cloudflare **Workers & Pages**, select **staging-healthbrowse-ai**, then its **Settings → Builds** connection. Connect **Healthbrowse/medical_assistant** and use the staging column of the table above. Set the build variable **`NODE_VERSION=24`**. Set **staging** as this Worker's production branch; the dashboard term refers to the active deployment of this particular Worker.

Initially disable branch Preview builds on the staging Worker. The persistent staging branch is sufficient for this release path. Do not use a copied production deploy command: Workers Builds can override a configured Worker name while still using the wrong top-level resource bindings. The explicit staging environment is essential.

Cloudflare documents [multiple environment Workers connected to one repository](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/), [build commands and runtime/build separation](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Node version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), and [Worker name overrides](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/).

## 5. Validate staging, then promote the reviewed revision

Both the HealthBrowse verification workflow and red-team workflow run on pushes to `staging` and `main`, as well as their existing PR triggers. Their Cloud Run release condition remains restricted to `main`; a staging push does not satisfy it.

Before promotion, record the deployed staging commit and check:

- CI, red-team and dependency/security gates succeed.
- `/healthz` and `/readyz` respond; these only establish service/asset readiness.
- Staging sign-in and an account-backed operation work against the dedicated database.
- General and clinician/Buddy requests use the intended model, preserve cited source meaning, and disclose insufficient evidence correctly. Use synthetic inputs and inspect actual output; an HTTP success or mechanical score is not clinical validation.
- Any provider evaluation is explicitly initiated and bounded. The opt-in `scripts/test-sarvam.mjs` harness may consume API credits and does not, by itself, test the deployed website's authentication or UI.

Open or update the PR from `staging` to `main` with the tested commit, results, model selection and outstanding limitations. If the candidate changes, test the changed candidate before merging. Do not copy staging secrets or the staging database into the top-level production configuration.

After review, merge the tested changes to `main`. The existing production Cloudflare connection should still target **healthbrowse-ai**, branch **main**, root **healthbrowse**, with its existing production bindings and runtime credentials. Inspect these external settings before release; the repository cannot prove how the dashboard is currently configured.

Also check the repository variable `HEALTHBROWSE_AUTO_DEPLOY`: when true, the existing GitHub workflow can independently release **Cloud Run** after a `main` push. Choose the intended deployment owners explicitly so a merge does not unexpectedly release through two systems. This change does not enable Cloud Run auto-deployment or alter its main-only gate.

## Routine changes after the initial setup

Keep both long-lived branches. Start each change from the current staging branch:

```sh
git fetch origin
git switch staging
git pull --ff-only origin staging
git switch -c feat/describe-the-change
```

Commit and push the feature branch, then open its PR with **base `staging`**. Merge after its checks and review; Cloudflare deploys the resulting staging revision. Verify that deployed revision, then open the promotion PR with **base `main`, compare `staging`**. Merge only after the staging acceptance results are recorded. A production hotfix should also be merged back into staging so subsequent releases retain it.

An administrator should configure branch rules for `main` and `staging` to require PRs, review and the intended verification checks, including `verify` and `red-team`. Confirm the actual check names in the repository before selecting them. Do not enable automatic merging of an untested promotion. Repository configuration files alone do not install these branch rules.

## Optional: branch Previews later

Persistent staging and branch Previews can coexist. To add branch Previews under staging, first define **`env.staging.previews`** with its own variables, bindings and secrets, then use **`npx --no-install wrangler preview --env staging`**. The existing top-level `previews` block belongs to the production Worker and is not this staging environment.

Previews do not inherit production settings. Two Previews using one D1 UUID share its rows and schema; database isolation requires separate resources. The existing `wrangler.preview-migrations.jsonc` targets the existing preview database and must not be used for the new persistent staging database. See [Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/) and [resources and migrations](https://developers.cloudflare.com/workers/previews/resources/).

Older Workers Builds connections may require a one-time, irreversible switch to Worker Previews. Inspect the [current branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) before changing that setting. Version URLs from `wrangler versions upload` use their configured Worker resources and are not a substitute for an isolated staging environment.
