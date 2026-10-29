# Contributing

[简体中文](CONTRIBUTING.md) · **English** · [Back to the project](README.en.md)

Help improve PC Hospital's documentation, interface, and service workflows. This guide walks through a first contribution. [AGENTS.md](AGENTS.md) is the engineering handbook; the [Git workflow](docs/git-workflow.md) defines branching and commit conventions. These detailed engineering documents are currently in Chinese.

## 1. Choose a focused problem

Search [issues](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues) and [PRs](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/pulls) to avoid duplicate work. Copy, documentation, and small reproducible bugs are good starting points. Discuss scope and acceptance criteria with a maintainer before changing business workflows, permissions, or personal data handling.

Keep each PR focused on one task. Start with this guide, the [engineering handbook](AGENTS.md), and the [design system](docs/design-system.md). Backend or data changes also require the architecture, database guide, and relevant public contracts.

## 2. Fork and create a branch

Select **Fork** on GitHub, then replace `YOUR_GITHUB_NAME` below with your account:

```bash
git clone https://github.com/YOUR_GITHUB_NAME/zafu-pchospital-web.git
cd zafu-pchospital-web
git remote add upstream https://github.com/ZAFU-PCHospital/zafu-pchospital-web.git
git fetch upstream main
git switch -c docs/short-description upstream/main
```

Use a branch name suited to your task, such as `fix/activity-message` or `feat/member-filter`. Run `git status` before starting. Preserve existing changes rather than clearing the checkout with reset / clean, and work on a feature branch instead of developing or pushing directly on `main`.

## 3. Set up locally

Use the Node.js and pnpm versions specified by [package.json](package.json), together with the existing lockfile.

- **Windows**: prepare the environment using the [WSL + Docker + GreatSQL guide](docs/database-windows.md), then follow the [README quick start](README.en.md#quick-start). The repository is already cloned, so skip its clone / cd commands.
- **Existing database or another OS**: configure local GreatSQL and `.env` using the [database guide](docs/database.md), then install dependencies, apply migrations, seed, check database health, and start development.
- **After restarting Windows**: run `.\tools\start-greatsql-wsl.ps1` from the repository root, then `pnpm dev`.

Keep environment files local. A process-level `DATABASE_URL` overrides `.env`; verify the effective target before migrations. Use local credentials and databases for development and verification, keeping production separate.

### Your first login

Seed creates roles, categories, and skills. **There is no default login account or shared initial password.** Ask a maintainer to help initialize the first administrator in a fresh local database, then prepare local accounts through the existing provisioning or invitation flow.

### Local handbook pages

`pnpm install` creates a placeholder documentation manifest when missing, so you can start with `pnpm dev` for website development.

Real `/handbook/` pages and a full `pnpm build` require mdBook. Handbook sources come from the separate [ZAFU-PCHospital-Doc](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc) repository and are cloned during the build when missing. See section 7 of [AGENTS.md](AGENTS.md) for an existing checkout, offline settings, and build configuration; the Windows guide also covers download mirrors.

`src/data/doc-manifest.json` and `public/handbook/` are generated outputs: do not edit or commit them. `pnpm build:site` is a quick website-only check, not a complete release build.

## 4. Find the right place to change

| Directory                | Responsibility                                      |
| ------------------------ | --------------------------------------------------- |
| `src/app/`               | Routes, page composition, and thin API Routes       |
| `src/components/`        | Page sections, interactions, and shared UI          |
| `src/config/`            | Copy, navigation, and page configuration            |
| `src/features/`          | Business Services / Repositories and transactions   |
| `src/lib/`, `src/types/` | Shared infrastructure, types, and contracts         |
| `prisma/`                | Schema, forward migrations, and seed                |
| `tests/`, `docs/`        | Automated verification and maintained documentation |

Search existing components and configuration before adding new implementations. Pages and Routes call Services rather than querying Prisma directly. Before changing a shared Contract or component API, find its consumers and update implementations, callers, and documentation together. Append migrations rather than editing applied SQL, and use Migration instead of `prisma db push`.

## 5. Validate the actual impact

Describe what changed, then select the smallest relevant checks. Sections 8 and 10 of [AGENTS.md](AGENTS.md) contain the full requirements.

| Change                        | Local focus                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation / copy          | Formatting, links, rule consistency, and `git diff --check`; browser checks are usually unnecessary if layout is unchanged                |
| Components / forms / lists    | Changed-file lint / formatting, relevant types and component / DOM assertions; desktop and narrow layouts when affected                   |
| Services / APIs / permissions | Targeted unit, contract, and necessary integration regression tests for permissions, privacy, and transactions                            |
| Schema / migrations           | An isolated `_test` GreatSQL database, serial execution; new migrations need empty-database, baseline-upgrade, and repeated-deploy checks |

For example, when changing these four onboarding documents:

```bash
pnpm exec prettier --check README.md README.en.md CONTRIBUTING.md CONTRIBUTING.en.md
git diff --check
```

Use the existing Node test runner for a relevant unit test, for example:

```bash
pnpm exec tsx --test tests/unit/repair-photo-policy.test.ts
```

Replace the test path to match your change. Coordinate full `pnpm lint` / `pnpm test` / `pnpm build` checks with CI and the maintainer. Reuse valid results for the same commit and rerun affected checks after fixes. Required CI and full-build gates still apply before merging.

### Database tests: switch databases first

Database tests create and delete fixtures, and some clear entire tables. Use **an isolated GreatSQL database whose name ends in `_test`**, run serially against a shared test database, and keep the guard enabled.

The Windows setup script creates `.env.test.local`, but `pnpm test:db` **does not read it automatically**. Follow the [isolated database steps](docs/database-windows.md#4-独立测试库) to switch `DATABASE_URL` explicitly, prepare the test database, and restore the previous value afterward. Unchanged migrations do not need the three migration scenarios repeated.

### Interface screenshots

Prefer component / DOM assertions for behavior. When visual changes need illustration, provide representative screenshots of the affected views, checking desktop, narrow layouts, focus, and overflow. Keep credentials and personal data out of public screenshots.

Keep verification screenshots outside the repository and attach only relevant images to the PR. `docs/assets/` holds the light / dark homepage previews used by the READMEs; feature PRs do not update these images routinely. Agree on scope with a maintainer before replacing them.

## 6. Open a pull request

Inspect `git diff` before committing and keep only files for the current task. For example, when updating both READMEs:

```bash
git add README.md README.en.md
git diff --cached
git commit -m "docs(readme): 更新项目说明"
git push -u origin docs/short-description
```

Select **Compare & pull request** in your fork and target `main` in `ZAFU-PCHospital/zafu-pchospital-web`. Use a commit type such as `feat`, `fix`, or `docs` and describe the concrete change. The repository's [Git workflow](docs/git-workflow.md) uses Chinese commit descriptions; more examples are available there.

Include in the PR description:

- The problem, resulting behavior, and related issue.
- Scope, including shared contracts, dependencies, or migration impact.
- Checks **run, reused, and not run**, with reasons; report failures and remaining limits.
- Representative screenshots and context for interface changes.

Wait for review and required CI. A maintainer merges according to repository permissions. Push review fixes to the same branch and rerun affected checks. Contributing a PR does not authorize a production deployment.

## 7. License

By submitting a pull request, you agree to license your contribution under the project's license ([AGPL-3.0-or-later](LICENSE)) and confirm that you have the right to submit it.
