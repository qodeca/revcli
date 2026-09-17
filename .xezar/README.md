# revcli Xezar kit

Project configuration, workflows and skills for developing **revcli** with Xezar. Modelled on the
kit the Xezar project ships for itself (`../xezar/.xezar`), reduced to what this repository actually
needs and rewritten against revcli's own commands and conventions in `AGENTS.md`. `AGENTS.md` stays
the authority; nothing here replaces it.

Runtime state stays in `.local/` (git-ignored at the repository root) and is never committed. The
`.xezar/.gitignore` in this directory excludes Xezar's own runtime paths, so maintained files here —
including anything added later — are versionable by default.

## Layout

- `config.json` — the project's cockpit choices: `baseBranch: main`, `defaultRunner: opencode`, the
  review gate off, per-runner model pins (OpenCode and pi, both local), and the shared system prompt.
  Unchanged by this kit: it was already authored for this repo.
- `workflows/` — 12 role workflows (below). Xezar loads them plus its two built-ins (`quick-task`,
  and `project-setup`, which runs the team `xez-onboard` skill).
- `skills/` — 14 project-local skills: the filled-in `project-conventions` plus thirteen `revcli-*`
  role playbooks. A skill's body becomes the agent's extra system prompt for that step.
- `pipeline/config.json` — the software-pipeline configuration the **team** `xez-*` skills read:
  validation commands, tracker, browser provider, spec and runtime paths, review checklist pointer.
- `review-checklist.md` — the repo-local checklist `xez-code-review` adds to its built-in one.

## Workflows

Writing roles all run this repo's real checks — `[ -d node_modules ] || npm ci` first (a task runs in
its own worktree, which is a fresh checkout with no dependencies), then `npm run typecheck`,
`npm test`, and `npm run build` where a build matters, each with a bounded repair return to the
authoring step — and all finish with an agent step, so the last step stays interactive and a question
can still reach the operator.

| Workflow | What it is for |
| --- | --- |
| `fix-and-verify` | The minimal built-in-style flow: prepare dependencies, do the task, run `npm test`, retry the authoring step twice on failure. |
| `bug-fix` | Reproduce, pin with a regression test, fix the cause, then typecheck and the suite. |
| `feature-implementation` | Contract-first feature work with tests, docs and the build. |
| `testing-and-verification` | Add or strengthen coverage in the repo's pure-function style. |
| `selector-maintenance` | revcli's own failure mode: stale Google Maps selectors, diagnosed from `--verbose` evidence, repaired only in `src/scraper/selectors.ts`. |
| `docs-maintenance` | Documentation that matches the code, with the audit reported. |
| `dependency-maintenance` | Dependency bumps in focused batches, lockfile included, gated by all three checks. |
| `plan-and-spec` | A right-sized spec in `docs/specs/` with criteria a command can decide. |
| `research` | A cited, dated answer from sources outside the repo, written to `docs/research/`. The only role granted `WebSearch`/`WebFetch`. |
| `code-review` | Read-only review of a diff or pull request against this repo's conventions. |
| `qa` | Read-only independent verification of one revision, criterion by criterion. |
| `issue-triage` | Read-only triage of an issue, then a recommendation and a question. |

The read-only roles are single-step on purpose: no dependency install, no gates, no commits. They run
in your own worktree and post nothing — publishing a finding to GitHub is the operator's call, and
`config.json`'s system prompt says so for every task.

## Skills

Discovery is local-first: `.xezar/skills` → `.ai/skills` → the `npx skills` install dirs and their
per-agent mirrors → `~/.agents/skills`, `~/.claude/skills` → the team skills repo. A local file wins a
name collision, so these thirteen `revcli-*` skills shadow nothing that exists and are found before any
team skill.

`project-conventions` (what good work looks like here — read by any step that wants the project's own
definition of done), `revcli-quality-gates` (canonical verification and the no-fabrication rules),
`revcli-implementation`, `revcli-bug-investigation`, `revcli-testing`, `revcli-selector-maintenance`,
`revcli-docs-maintenance`, `revcli-dependency-maintenance`, `revcli-planning-spec`,
`revcli-code-review`, `revcli-qa`, `revcli-issue-triage`, `revcli-research`, `revcli-release`.

## Team skills repo

`qodeca/xezar-skills` is Xezar's **default** skills source, so this project needs no `skillsRepos`
key: with the key absent, all 39 `xez-*` skills resolve (verified with the installed loader against
this checkout — 13 local skills, 39 team skills, 15 global; the local count is 14 since
`revcli-release` was added). They bring the issue-to-PR automation
(`xez-auto-fix-issue`, `xez-auto-create-pr`, `xez-auto-review-pr`, `xez-qa-pr`), the spec and
discovery skills, `xez-issue-create`, `xez-root-cause`, `xez-verify-in-repo`, and the pipeline
configurator `xez-setup-agent-pipeline`. Their cache lives in `~/.cache/xez/skills/` and
background-updates at most once per six hours; `XEZ_SKILLS_AUTO_UPDATE=0` stops the updates.

Two things to know before editing `config.json`:

- **Adding `skillsRepos` here replaces the default rather than extending it**, and a repo that names
  its own sources is no longer gated by the imported-skills selection. Add the key only to swap in a
  different source.
- **Curating which team skills show** is a *global* choice, not a project one: the `importedSkills`
  array in `~/.xezar/ui-state.json` (absent = all team skills shown; an array, even empty, = only
  those). Settings → Skills is the way to change it; it is not a per-repo setting and does not belong
  in this directory.

`pipeline/config.json` is what makes those team skills verify with **this** repo's commands instead of
guessing: `npm run typecheck`, `npm test`, `npm run build`; `baseBranch: auto`; `tracker: github`;
`browser.provider: playwright` (Playwright is revcli's own dependency and the only browser automation
here); specs in `docs/specs/`; run/analysis/QA scratch under the git-ignored `.local/pipeline/`;
`reviewChecklist` pointing at `.xezar/review-checklist.md`. `labels.enabled` is `false` because this
repository carries only GitHub's default labels — no pipeline or QA label taxonomy exists there, and
inventing one would mean skills writing labels nobody maintains. `ci.maxWaitMinutes` is `0` because
this repository has no CI workflow to observe: pending CI is never a pass and never a wait. `qaGate`
stays `true`: independent verification is still required, and it is the `qa` workflow, not a label,
that provides it.

## Deliberately not installed

What the Xezar project's own kit has, and why it is not copied here:

- **`.xezar/checks/*.sh` and `checks/lib/`** (bootstrap, worktree preflight/setup/readiness,
  `repo-gates.sh`, `security-scan.sh`, `phase-record.sh`, `verify-evidence.sh`, `catalog-check.mjs`,
  `kit-manifest.json`). That machinery enforces *Xezar's* SDLC — phase records with CAPABILITY /
  DEPTH / MATURITY / CRITERIA / COUNTERS fields, sealed gate evidence, a `pkill`-hazard audit,
  design-system drift, the npm release pipeline. revcli has none of those files or processes, so the
  scripts would fail or, worse, report success while proving nothing. revcli's gate is three npm
  scripts, run directly.
- **`release`, `release-prep`, `integration`, `root-sync` workflows.** revcli has no CI workflow,
  publishes only through a manual `npm publish` (its `prepublishOnly` builds), and `config.json`
  forbids committing, pushing or publishing anything a task did not explicitly authorize. A
  release *workflow* would still have no CI gate to wait on. What exists instead is the `revcli-release` **skill**: it runs the three npm gates and an `npm pack --dry-run` tarball audit on the release candidate and emits the manual publish checklist — tagging, pushing and `npm publish` stay operator-only steps.
- **`design`, `design-review` workflows and `docs/design-system/`.** This repository is a CLI: there
  is no UI, no design tokens and nothing in `designs/`.
- **`.xezar/docs/` dogfooding documents** (`dogfooding.md`, `installation.md`, `phase-record.md`,
  `parallel-tasks.md`, `recovery.md`, `worktrees.md`, `ui-operations.md`, `enhancement-ideas.md`) and
  `pipeline/trackers/github.md`. They are Xezar's own product feedback and its copy of the GitHub
  descriptor; the team skills fall back to the descriptor they ship, so a stale local copy would only
  add drift.
- **`kit-manifest.json`** provenance snapshot — a hash ledger of a kit revcli does not maintain.

## Still to do by a person

1. Run the checks once in a fresh worktree to confirm the timings you like (`npm ci` over the
   Playwright package is the slow step), and adjust `timeout` on the authoring steps if two hours is
   too generous.
2. Decide whether the team skills should be curated down in Settings → Skills, and whether live
   scrape verification (which needs `revcli auth` and a visible browser) is something you want agents
   to attempt at all — every skill in this kit currently treats a live scrape as the operator's check
   and reports it as *not verifiable here* when it cannot run.
3. If you later add labels or a CI workflow to this repository, update `pipeline/config.json`
   (`labels.enabled`, `ci.maxWaitMinutes`) in the same change; until then both stay off deliberately.
