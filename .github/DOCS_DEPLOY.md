# docs-site deployment to Cloudflare Pages

`apps/docs-site` is a static build (`bun run build` → `apps/docs-site/dist/`, no server, no env
vars). It ships to Cloudflare Pages via a manual GitHub Actions workflow,
[`.github/workflows/docs-deploy.yml`](./workflows/docs-deploy.yml).

## Deploy model

- **Manual trigger only.** No push-to-branch auto-deploy. Open the Actions tab, pick the branch
  in GitHub's built-in **Use workflow from** dropdown, hit *Run workflow*. No inputs to fill.
- **Branch = the run's ref.** `actions/checkout` with no `ref:` builds whichever branch you
  picked in the dropdown. That branch's copy of the workflow file is also what runs.
- **Always a production deploy.** The deploy step passes `--branch=main` to Wrangler, so the
  result lands on the Pages **production** deployment (`docs.streakjs.com`) regardless of which
  branch built it. Preview deployments are not set up (see [Later](#later)).
- **Build before deploy.** The `build` job has no Cloudflare access. If the site fails to
  build, the run fails and nothing reaches Cloudflare. `deploy` downloads the exact `dist/`
  artifact and never rebuilds.
- **Scoped token only.** Auth is a Cloudflare API token scoped to *Account → Cloudflare Pages →
  Edit*. No DNS or Workers access. Lives in the `docs-deploy` environment's secrets.

## The workflow

Already saved at [`.github/workflows/docs-deploy.yml`](./workflows/docs-deploy.yml):

```yaml
name: docs site deploy

on:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: docs-deploy
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # checks out the branch picked in "Use workflow from"

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build docs site
        working-directory: apps/docs-site
        run: bun run build

      - name: Upload build output
        uses: actions/upload-artifact@v4
        with:
          name: docs-dist
          path: apps/docs-site/dist
          if-no-files-found: error
          retention-days: 3

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: docs-deploy  # scopes the Cloudflare secrets; add a required reviewer here for an approval gate
    steps:
      - name: Download build output
        uses: actions/download-artifact@v4
        with:
          name: docs-dist
          path: dist

      - name: Publish to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=streak-docs --branch=main
```

Notes:

- `deploy` needs no `actions/checkout` — it only needs the `dist/` artifact and the two
  secrets.
- `--branch=main` is what makes it a production deploy (it matches the project's configured
  production branch). It is **not** the git branch you built — that's the dropdown pick.
- `--project-name=streak-docs` must match the Pages project name from setup. Change both
  together if you rename.
- `bun install --frozen-lockfile` needs the committed root `bun.lock` in sync with
  `package.json`. If install fails on a lockfile mismatch, run `bun install` locally and commit
  the updated `bun.lock`. (There is uncommitted `bun.lock` drift in the working tree right
  now — resolve it before the first run.)
- `environment: docs-deploy` with no protection rules does **not** pause the run. Add a
  *Required reviewer* to that environment later if you want an approval step.
- `apps/docs-site/vercel.json` is unused once this is the deploy path — leave or delete it, no
  effect here.

## One-time setup

UI actions, done once.

**On Cloudflare (dash.cloudflare.com):**

1. *Workers & Pages → Create → Pages → Upload assets*. Name the project **`streak-docs`**.
   Upload nothing / a throwaway file — the workflow's first run replaces it. It just has to
   exist so `wrangler pages deploy` has a target (CI can't answer the "create it?" prompt).
2. Open the project → *Settings* → set the **Production branch** to `main`.
3. *Settings → Custom domains → Set up a custom domain* → `docs.streakjs.com`.
   - If `streakjs.com` is a zone on this same Cloudflare account, the DNS record is created
     automatically.
   - Otherwise add a `CNAME` `docs` → `streak-docs.pages.dev` at your DNS provider.
4. Account ID: project *Overview*, right sidebar (or `wrangler whoami`). Copy it.
5. *My Profile → API Tokens → Create Token → Create Custom Token*:
   - Permissions: **Account · Cloudflare Pages · Edit** (nothing else).
   - Account Resources: **Include → your account**.
   - Create, copy the token (shown once).

**On GitHub (repo Settings):**

1. *Settings → Environments → New environment* named `docs-deploy`.
2. In that environment, *Environment secrets → Add secret*, add two:
   - `CLOUDFLARE_API_TOKEN` — the token from Cloudflare step 5.
   - `CLOUDFLARE_ACCOUNT_ID` — the ID from Cloudflare step 4.
   - (Repo-level secrets work too; environment-scoped keeps them off every other workflow.)
3. Optional: in the environment, *Deployment protection rules → Required reviewers* → add
   yourself for an approve-before-deploy gate. *Deployment branches* can restrict which branch
   the run may start from (it works here — the branch is the run's real ref).
4. Merge `.github/workflows/docs-deploy.yml` to the default branch — the *Run workflow* button
   only appears once the file is on the repo's default branch.
5. Confirm third-party actions are allowed (*Settings → Actions → General → Actions
   permissions*): `oven-sh/setup-bun`, `cloudflare/wrangler-action`.

## How to deploy

1. *Actions* tab → **docs site deploy** → *Run workflow*.
2. **Use workflow from**: pick the branch to build and ship.
3. Run. `build` checks out that branch and builds `apps/docs-site`. If it fails, nothing else
   happens.
4. `deploy` downloads the build and pushes it to Cloudflare (pausing for approval only if you
   added a required reviewer).
5. The step log prints the deployment URL. It's live at `https://docs.streakjs.com` within a
   minute.

## Rollback

Cloudflare keeps every deployment. *Workers & Pages → streak-docs → Deployments →* pick a
previous one → *Rollback to this deployment*. No workflow run needed.

## Later

- **Preview deployments.** Add a `target: [preview, production]` choice input and send
  `--branch=<something-not-main>` for previews (`https://<hash>.streak-docs.pages.dev`).
- **Auto-deploy on merge to the default branch.** Add a `push` trigger.
- **PR preview comments.** Post the preview URL back onto the PR.
