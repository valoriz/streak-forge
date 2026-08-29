# streak-forge npm release process

This document is the design for the automated npm release pipeline for `packages/streak-forge`: a **beta** publish workflow (`npm-beta-release.yml`) and a **promote-to-`latest`** workflow (`npm-promote-stable.yml`). Design doc first — each workflow below is ready to save under `.github/workflows/` once reviewed.

## Release model

- **Manual trigger only.** No push-to-branch or tag-push auto-publish. A human opens the Actions tab, picks the branch from GitHub's built-in **Use workflow from** dropdown, and runs it. That branch is what gets built, published, and tagged — there is no separate branch input.
- **Version comes from `packages/streak-forge/package.json`.** The workflow reads the committed `version` field. If it already carries a `-beta` prerelease (`4.1.6-beta.0`) it publishes that as-is; if it's a plain version (`4.2.0`) the workflow appends `-beta.0`. To cut the next beta, bump the version in `package.json` and commit it before running. A non-`beta` prerelease (`4.2.0-rc.1`) is rejected.
- **Beta only.** Every publish uses `npm publish --tag beta` — it never touches the `latest` dist-tag. Existing users on `npm install streak-forge` are unaffected; opting into a beta is `npm install streak-forge@beta`.
- **Owner-gated.** The publish step runs inside a GitHub *Environment* (`npm-publish`) with a required reviewer. Anyone with repo write access can *start* the workflow, but the job that actually touches npm/tags/releases pauses for manual approval from the owner's account specifically — this holds even if other collaborators get write access later.
- **No long-lived npm token.** Auth uses npm's [Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements) (OIDC) — npm verifies the publish came from this exact repo + workflow + environment via a short-lived token GitHub issues at run time. There's no `NPM_TOKEN` secret to create, store, or rotate.
- **Build gate before the owner is even asked.** Typecheck/lint/build run in their own job first, with no environment gate. If that fails, the workflow just fails — nothing reaches the point of asking for approval.

## Draft workflow

Save as `.github/workflows/npm-beta-release.yml` after the [manual setup](#one-time-manual-setup) below is done — publishing will fail without it (no Trusted Publisher configured, or no `npm-publish` environment to satisfy).

```yaml
name: npm beta release

on:
  workflow_dispatch:

permissions:
  contents: write  # tag the release commit, create the GitHub Release
  id-token: write  # npm OIDC / Trusted Publishing provenance

concurrency:
  group: npm-beta-release
  cancel-in-progress: false

jobs:
  build-and-verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # checks out the branch picked in "Use workflow from"

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck
        run: node_modules/.bin/tsc --noEmit -p packages/streak-forge/tsconfig.json

      - name: Lint
        run: bun run lint

      - name: Build
        working-directory: packages/streak-forge
        run: bun run build

  publish:
    needs: build-and-verify
    runs-on: ubuntu-latest
    environment: npm-publish  # <- the required-reviewer gate lives here
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Update npm CLI
        # Trusted Publishing needs a recent npm CLI (11.5.1+) - the version
        # bundled with the runner's preinstalled Node is usually older.
        run: npm install -g npm@latest

      - name: Resolve beta version from package.json
        id: ver
        working-directory: packages/streak-forge
        run: |
          current="$(node -p "require('./package.json').version")"
          case "$current" in
            *-beta.*|*-beta) version="$current" ;;                       # already a beta prerelease
            *-*) echo "::error::version '$current' has a non-beta prerelease tag - fix packages/streak-forge/package.json"; exit 1 ;;
            *) version="${current}-beta.0" ;;                            # plain version -> first beta
          esac
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "Publishing streak-forge@$version"

      - name: Guard - version not already on npm
        run: |
          if npm view "streak-forge@${{ steps.ver.outputs.version }}" version >/dev/null 2>&1; then
            echo "::error::streak-forge@${{ steps.ver.outputs.version }} is already published - bump the version in packages/streak-forge/package.json"
            exit 1
          fi

      - name: Set version
        working-directory: packages/streak-forge
        run: npm pkg set version="${{ steps.ver.outputs.version }}"

      - name: Build
        working-directory: packages/streak-forge
        run: bun run build

      - name: Publish to npm (beta tag)
        working-directory: packages/streak-forge
        run: npm publish --tag beta --provenance --access public

      - name: Tag the release commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag "streak-forge@${{ steps.ver.outputs.version }}"
          git push origin "streak-forge@${{ steps.ver.outputs.version }}"

      - name: Resolve release-notes file
        id: notes
        run: |
          # Notes live per minor line: RELEASE-<major>.<minor>.md
          # (e.g. 4.1.6-beta.0 -> RELEASE-4.1.md). Fall back to a generic
          # name, then to no notes file at all.
          minor="$(echo "${{ steps.ver.outputs.version }}" | grep -oE '^[0-9]+\.[0-9]+')"
          for f in "RELEASE-${minor}.md" "RELEASE_NOTES.md"; do
            if [ -f "$f" ]; then echo "file=$f" >> "$GITHUB_OUTPUT"; break; fi
          done

      - name: Create draft GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          NOTES_FILE: ${{ steps.notes.outputs.file }}
        run: |
          gh release create "streak-forge@${{ steps.ver.outputs.version }}" \
            --title "streak-forge v${{ steps.ver.outputs.version }}" \
            ${NOTES_FILE:+--notes-file "$NOTES_FILE"} \
            --prerelease \
            --draft
```

Notes on the draft:

- `build-and-verify` reruns independently in `publish` (fresh runner, nothing carries over) — slightly redundant but simplest to reason about for a first version; can be optimized later by passing a build artifact between jobs instead of rebuilding.
- **Branch = the run's ref.** No branch input. `actions/checkout` with no `ref:` checks out whatever branch you chose in *Use workflow from*, and that's also which copy of this workflow file runs. Because the branch is the real run ref, the `npm-publish` environment's *Deployment branches* rule works as a proper gate (see setup).
- **`Resolve beta version` step** derives the published version from `packages/streak-forge/package.json`: a `-beta.N` / `-beta` version is used as-is, a plain version gets `-beta.0` appended, any other prerelease tag fails the run.
- **`Guard` step** fails if that version is already on npm — npm would reject the publish anyway, this fails earlier with a clear "bump the version" message.
- `npm pkg set version=...` only changes the *published* version — it doesn't commit that back to the repo. The committed `package.json` version is the source of truth for *what* to publish; the workflow never writes to it.
- The git tag and GitHub Release both use the `streak-forge@<version>` format so they don't collide with any future tags for `create-streak-app`.
- The Release is created `--draft` — it exists and is linkable internally, but isn't visible/public until you publish it yourself from the GitHub UI.
- Release notes are read from `RELEASE-<major>.<minor>.md` (e.g. `RELEASE-4.1.md` for any `4.1.x` publish). Keep that file updated as the 4.1 line evolves; start a new `RELEASE-4.2.md` when that line opens. If no matching file exists the release is still created, just without a notes body.

## One-time manual setup

These are npm.com/GitHub UI actions — outside what I have access to from here. Do these once, before the workflow file is added and first run.

**On npmjs.com:**
1. Go to the `streak-forge` package → *Settings* → *Trusted Publisher*.
2. Add a GitHub Actions trusted publisher for the beta workflow:
   - Repository: `valoriz/streak-forge`
   - Workflow filename: `npm-beta-release.yml`
   - Environment name: `npm-publish`
3. Add a **second** trusted publisher for the promote workflow (only if you add `npm-promote-stable.yml`):
   - Repository: `valoriz/streak-forge`
   - Workflow filename: `npm-promote-stable.yml`
   - Environment name: `npm-publish`
   - npm allows multiple trusted publishers per package; each workflow file needs its own entry.

**On GitHub (repo Settings):**
1. *Settings → Environments → New environment* named `npm-publish`.
2. Under *Deployment protection rules*, add **Required reviewers** and add the owner's account.
3. Under *Deployment branches*, restrict this environment to `main` (or whichever branch releases should come from). The workflow runs from the branch picked in *Use workflow from*, so this rule really does gate it — a run started from any other branch is refused at the `publish` job before it can touch npm, without relying on the reviewer to notice the wrong branch.
4. Confirm *Settings → Actions → General → Workflow permissions* allows `id-token: write` (needed for OIDC).

## How to cut a beta

1. Make sure `packages/streak-forge/package.json`'s `version` is what you want published (bump + commit it first if the last beta used this same version).
2. Actions tab → **npm beta release** → *Run workflow*.
3. **Use workflow from**: pick the branch to release (must match the environment's allowed branch, e.g. `main`).
4. `build-and-verify` runs typecheck/lint/build. If it fails, nothing else happens.
5. The `publish` job resolves the version from `package.json`, then requests approval on the `npm-publish` environment. Approve it (as the owner).
6. Confirm the result:
   ```bash
   npm view streak-forge@beta version
   ```
7. Review and (when ready) publish the draft GitHub Release that was created.

## Promoting a beta to `latest`

A second manual workflow, `npm-promote-stable.yml`. It does **not** move a dist-tag — it publishes a clean, suffix-free stable version (`4.1.0`) built from the **exact git tag the beta was cut from** (`streak-forge@4.1.0-beta.3`), so `latest` never points at a semver prerelease and the promoted artifact is provably the same source as the beta that was tested.

### Why not just `npm dist-tag add ... latest`

- The beta version keeps its `-beta.N` suffix, which is a semver prerelease. `npm install streak-forge` would then resolve to `4.1.0-beta.3`, and some tooling treats a prerelease `latest` as "no stable release exists".
- `npm dist-tag` over Trusted Publishing / OIDC is far less exercised than `npm publish`; the OIDC short-lived token is issued for publish. Re-publishing stays on the well-supported path.

### Draft workflow

Save as `.github/workflows/npm-promote-stable.yml`. Needs its **own** Trusted Publisher entry (see [setup](#one-time-manual-setup) — same repo + environment, workflow filename `npm-promote-stable.yml`).

```yaml
name: npm promote to latest

on:
  workflow_dispatch:
    inputs:
      beta_tag:
        description: "Beta git tag to promote, e.g. streak-forge@4.1.0-beta.3"
        required: true
        type: string

permissions:
  contents: write  # tag the stable release, create the GitHub Release
  id-token: write  # npm OIDC / Trusted Publishing provenance

concurrency:
  group: npm-beta-release  # same lane as the beta workflow - never publish two at once
  cancel-in-progress: false

jobs:
  build-and-verify:
    runs-on: ubuntu-latest
    steps:
      - name: Resolve stable version from the beta tag
        id: ver
        run: |
          beta='${{ inputs.beta_tag }}'; beta="${beta#streak-forge@}"
          case "$beta" in
            *-beta.*|*-beta) : ;;
            *) echo "::error::'${{ inputs.beta_tag }}' is not a -beta tag"; exit 1 ;;
          esac
          stable="${beta%%-beta*}"          # 4.1.0-beta.3 -> 4.1.0
          echo "stable=$stable" >> "$GITHUB_OUTPUT"
          echo "Promoting $beta -> $stable"

      - name: Check out the beta tag
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.beta_tag }}

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck
        run: node_modules/.bin/tsc --noEmit -p packages/streak-forge/tsconfig.json

      - name: Lint
        run: bun run lint

      - name: Build
        working-directory: packages/streak-forge
        run: bun run build

  publish:
    needs: build-and-verify
    runs-on: ubuntu-latest
    environment: npm-publish  # reuses the same required-reviewer gate
    steps:
      - name: Resolve stable version from the beta tag
        id: ver
        run: |
          beta='${{ inputs.beta_tag }}'; beta="${beta#streak-forge@}"
          case "$beta" in
            *-beta.*|*-beta) : ;;
            *) echo "::error::'${{ inputs.beta_tag }}' is not a -beta tag"; exit 1 ;;
          esac
          echo "stable=${beta%%-beta*}" >> "$GITHUB_OUTPUT"

      - name: Check out the beta tag
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.beta_tag }}

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Update npm CLI
        run: npm install -g npm@latest

      - name: Guard - stable version must not already exist on npm
        run: |
          if npm view "streak-forge@${{ steps.ver.outputs.stable }}" version >/dev/null 2>&1; then
            echo "::error::streak-forge@${{ steps.ver.outputs.stable }} is already published"; exit 1
          fi

      - name: Set stable version
        working-directory: packages/streak-forge
        run: npm pkg set version="${{ steps.ver.outputs.stable }}"

      - name: Build
        working-directory: packages/streak-forge
        run: bun run build

      - name: Publish to npm (latest tag)
        working-directory: packages/streak-forge
        run: npm publish --provenance --access public  # no --tag => latest

      - name: Tag the stable release
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag "streak-forge@${{ steps.ver.outputs.stable }}"
          git push origin "streak-forge@${{ steps.ver.outputs.stable }}"

      - name: Resolve release-notes file
        id: notes
        run: |
          minor="$(echo "${{ steps.ver.outputs.stable }}" | grep -oE '^[0-9]+\.[0-9]+')"
          for f in "RELEASE-${minor}.md" "RELEASE_NOTES.md"; do
            if [ -f "$f" ]; then echo "file=$f" >> "$GITHUB_OUTPUT"; break; fi
          done

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          NOTES_FILE: ${{ steps.notes.outputs.file }}
        run: |
          gh release create "streak-forge@${{ steps.ver.outputs.stable }}" \
            --title "streak-forge v${{ steps.ver.outputs.stable }}" \
            ${NOTES_FILE:+--notes-file "$NOTES_FILE"} \
            --latest
```

Notes on the draft:

- **One input: the beta tag.** The stable version is derived by stripping `-beta.N` (`streak-forge@4.1.0-beta.3` → publish `4.1.0`). A tag that isn't a `-beta` tag fails the run.
- **Source is the beta tag, not a branch.** Checking out `streak-forge@4.1.0-beta.3` guarantees the stable build is byte-for-byte the same source that was published and tested as that beta. No branch drift.
- **`npm publish` with no `--tag` goes to `latest`.** That's the whole promotion — a normal publish of a normal version.
- **The `Guard` step** fails if the derived stable version is already on npm — npm would reject the publish anyway, this just fails earlier with a clear message.
- The GitHub Release is created live and marked `--latest` (not `--draft`/`--prerelease` like the beta flow) — promotion implies you're ready for it to be visible.
- The version resolution runs in both jobs (a step output doesn't cross jobs); it's a few lines of shell, cheaper than wiring a job output.
- **Alternative: one workflow, not two.** `npm-beta-release.yml` could take a `channel: [beta, latest]` choice input instead, folding both flows into one file (one Trusted Publisher entry, less duplication). Kept separate here because the flows genuinely differ (build a branch's `package.json` version vs check out a beta tag and strip its suffix) and a promote is rare enough that a dedicated, obviously-named workflow is clearer.

## How to promote a beta

1. Actions tab → **npm promote to latest** → *Run workflow*.
2. **Use workflow from**: the environment's allowed branch (e.g. `main`) — this only picks which workflow file runs; the code that ships is the beta tag's.
3. **Beta git tag to promote**: the tag the beta workflow created, e.g. `streak-forge@4.1.0-beta.3`.
4. `build-and-verify` checks out that tag and runs typecheck/lint/build. If it fails, nothing else happens.
5. `publish` requests approval on `npm-publish` — approve it (as the owner).
6. Confirm:
   ```bash
   npm view streak-forge version        # should print the stable version
   npm view streak-forge dist-tags      # latest -> stable, beta -> whatever it was
   ```
