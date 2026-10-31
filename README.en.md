<p align="center">
  <a href="https://pczafu.cn/"><img src="public/icon.png" width="88" height="88" alt="ZAFU PC Hospital logo" /></a>
</p>

<h1 align="center">ZAFU PC Hospital · Official Website &amp; Club Platform</h1>

<p align="center">Supporting volunteer repairs, events, and club collaboration</p>

<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

<p align="center">
  <a href="https://github.com/ZAFU-PCHospital/zafu-pchospital-web/actions/workflows/ci.yml"><img src="https://github.com/ZAFU-PCHospital/zafu-pchospital-web/actions/workflows/ci.yml/badge.svg" alt="CI checks and build" /></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-15.5.28-171717?logo=nextdotjs&amp;logoColor=white" alt="Next.js 15.5.28" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-149eca?logo=react&amp;logoColor=white" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&amp;logoColor=white" alt="TypeScript strict" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS-4-0f7490?logo=tailwindcss&amp;logoColor=white" alt="Tailwind CSS 4" /></a>
  <a href="https://www.prisma.io/"><img src="https://img.shields.io/badge/Prisma-7.10.1-2d3748?logo=prisma&amp;logoColor=white" alt="Prisma 7.10.1" /></a>
  <a href="https://greatsql.cn/"><img src="https://img.shields.io/badge/GreatSQL-8.0.32--27-276b60" alt="GreatSQL 8.0.32-27" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-12.4.1-f69220?logo=pnpm&amp;logoColor=white" alt="pnpm 12.4.1" /></a>
</p>

<p align="center">
  <a href="https://pczafu.cn/">Website</a> ·
  <a href="https://pczafu.cn/repair-activities">Repair events</a> ·
  <a href="https://pczafu.cn/docs">Technical handbook</a> ·
  <a href="#quick-start">Run locally</a> ·
  <a href="CONTRIBUTING.en.md">Contribute</a>
</p>

## What the platform offers

PC Hospital provides volunteer computer support to students and staff at Zhejiang A&F University. This project brings the public website, event registration, and internal club workflows into one platform, and works on desktop and mobile in light and dark modes.

| Audience       | Features                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visitors       | Club information, membership applications, repair event browsing and registration, and the technical handbook for students and staff                                                                                                 |
| Members        | QQ account login, invitation-based registration, email management and password recovery; repair records and photos, event attendance and reception, the case library and favorites, notifications, personal statistics, and rankings |
| Administrators | Members and roles, application / repair reviews, events and attendance check-in, categories and skills, invitations, list filtering and sorting, exports, audit logs, and public display settings                                    |

## Preview

<a href="https://pczafu.cn/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/01-home-desktop-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/01-home-desktop-normal.png" />
    <img src="docs/assets/01-home-desktop-normal.png" alt="PC Hospital website homepage preview" width="1440" />
  </picture>
</a>

These archived homepage screenshots illustrate the site; the live interface may have changed. Select an image to visit the website.

## Quick start

### Requirements

- **Node.js**: `^20.19 || ^22.12 || >=24.0`; see `engines` in [package.json](package.json).
- **pnpm**: use the version pinned in `packageManager` (currently `12.4.1`). Corepack must be at least `0.34.5`; see the [version checks and upgrade steps](docs/database-windows.md#31-corepack-兼容要求) (Chinese).
- **GreatSQL 8.0.32-27**: on Windows, use Docker Engine inside WSL. See the [database guide](docs/database.md) for other environments.

### Run on Windows

Prepare WSL and Docker using the [Windows guide](docs/database-windows.md), then run these commands in **Windows PowerShell**:

```powershell
git clone https://github.com/ZAFU-PCHospital/zafu-pchospital-web.git
cd zafu-pchospital-web
corepack --version   # At least 0.34.5; upgrade first using the environment guide if older
corepack enable pnpm
corepack pnpm --version   # Currently expected: 12.4.1
pnpm --version           # Must match the previous command; otherwise troubleshoot first
.\tools\setup-greatsql-wsl.ps1
pnpm install
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
pnpm dev
```

Open <http://localhost:3000>. The setup script creates local `.env` and isolated test database configuration when missing, preserving existing files. Before database commands, verify that the effective `DATABASE_URL` points to your intended local database.

If `pnpm.cjs` cannot be found, or `pnpm` and `corepack pnpm` report different versions, follow [Corepack troubleshooting](docs/database-windows.md#33-corepack-排错) for version, stale-cache, and PATH checks rather than changing the lockfile (Chinese).

If GreatSQL is already configured, or you use Linux / macOS, configure the database and `.env` following the [database guide](docs/database.md), then start with `pnpm install` above.

**For your first run:**

- Seed initializes roles, repair categories, and skills. **It does not create a default login account.** Ask a maintainer to help initialize the first administrator in a new local database.
- After restarting Windows, run `.\tools\start-greatsql-wsl.ps1` to restore the database environment.
- `pnpm dev` does not require mdBook and does not generate handbook pages. Local `/handbook/` content and the full `pnpm build` require mdBook; see section 7 of [AGENTS.md](AGENTS.md).

<details>
<summary>Common commands</summary>

| Command           | Purpose                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`        | Local development                                                                                                                                      |
| `pnpm test`       | Unit and contract tests; database integration tests are skipped by default                                                                             |
| `pnpm lint`       | ESLint and website / handbook palette consistency checks                                                                                               |
| `pnpm audit`      | Check locked dependencies for known vulnerabilities; see [AGENTS.md section 11](AGENTS.md#11-ci-与部署) for how to address findings                    |
| `pnpm build`      | Full build, including the mdBook handbook                                                                                                              |
| `pnpm docs:build` | Build the handbook separately                                                                                                                          |
| `pnpm build:site` | Website-only check; not for deployment                                                                                                                 |
| `pnpm test:db`    | Serial integration tests against an isolated `_test` database only; follow the [database switching steps](docs/database-windows.md#4-独立测试库) first |

</details>

## Your first contribution

Documentation, copy, interface improvements, and focused bug fixes are welcome. Start with a clearly scoped issue:

**Agree on the problem → Fork / create a branch → Make a local change → Validate its impact → Open a PR**

The [contribution guide](CONTRIBUTING.en.md) covers the workflow, directory layout, test databases, and a PR checklist. Documentation-only changes need formatting, link, and rule consistency checks. Add relevant verification for interaction, API, or data changes, and coordinate full checks with CI to avoid duplicate work.

## Documentation

See the [maintenance document index](docs/README.md) for the full list of guides and how to find historical records.

The engineering documents below are currently in Chinese; the English contribution guide explains the main entry points.

| Topic                                                          | Start here                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Environment, commands, validation, and CI                      | [Engineering handbook: AGENTS.md](AGENTS.md)                                                                              |
| Layout, themes, and reusable components                        | [Design system](docs/design-system.md)                                                                                    |
| Directory responsibilities and Service / Repository boundaries | [Architecture](docs/architecture.md)                                                                                      |
| Local databases, migrations, and isolated tests                | [Database guide](docs/database.md) · [Windows setup](docs/database-windows.md)                                            |
| API, data, and cross-module agreements                         | [Public contracts](docs/contracts/)                                                                                       |
| Branches, commits, and PRs                                     | [Git workflow](docs/git-workflow.md)                                                                                      |
| Computer repair reference material                             | [Online handbook](https://pczafu.cn/docs) · [Handbook repository](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc) |

## Deployment and maintenance

Declared dependencies and resolved versions are recorded in [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml). See [AGENTS.md section 11](AGENTS.md#11-ci-与部署) for security updates and transitive dependency overrides.

Only authorized maintainers deploy: the [deploy skill](.agents/skills/zafu-pchospital-deploy/SKILL.md) is the operating handbook and [`tools/deploy/deploy-prod.sh`](tools/deploy/deploy-prod.sh) is the single entry point, covering local build, backup, upload, atomic artifact switch, and smoke checks. Production requires a Node.js server, GreatSQL, and persistent photo storage.

See the deployment handbook for options, gates, and recovery; see [deployment notifications](tools/deploy/NOTIFICATIONS.md) for notification configuration.

## Questions and suggestions

Search [existing issues](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues) first. When reporting a problem, include reproduction steps, expected behavior, and actual behavior. Remove credentials and personal information from screenshots and logs.

## License

Copyright © 浙江农林大学电脑医院 (ZAFU PC Hospital)

The project code is licensed under the GNU Affero General Public License, version 3.0 or any later version ([AGPL-3.0-or-later](LICENSE)).

If you modify this project and provide a service over a network, you must offer users who interact with that version remotely a way to obtain its complete Corresponding Source, as required by the license.

The club name, Logo, university name and emblems, and other identifying marks are outside the scope of this license and may not be used for other purposes without permission. Fonts, images, and other non-code assets are also excluded from the project code license and remain subject to their own licensing terms. Third-party dependencies retain their respective licenses.

`.env` files, database contents, repair photos, and member information are operational data and are not made public as part of this repository.
