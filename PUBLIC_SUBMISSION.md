# Public Submission Readiness

Last checked: 2026-08-27

## Ready

- MIT licensing is present in `LICENSE` and declared by both package manifests.
- `.gitignore` and `.dockerignore` exclude dependency trees, compiled output, coverage, logs, environment files, local Sibyl environments, and demo databases.
- Only safe environment examples are present. They contain placeholders, never usable secrets.
- A source scan found no private-key blocks, provider API keys, GitHub tokens, AWS access keys, or embedded production credentials. Matches were environment interpolation, documented placeholders, and explicit test-only dummy values.
- Root production dependencies audit with zero known vulnerabilities.
- Backend audit's directly fixable WebSocket advisory is pinned to `ws@8.21.3` in the affected dependency subtree.
- Tests, typechecks, builds, lint, formatting, clean migrations, recovery, and the load-bearing memory gate are recorded in `PRODUCTION_CHECKLIST.md`.
- The deployable backend image builds non-root and contains the official `sibyl-memory-mcp==0.1.13` package.

## Unresolved upstream advisories

The official `@virtuals-protocol/acp-node-v2@0.1.12` tree retains 22 npm audit findings: 13 low, 4 moderate, and 5 high. The reported `elliptic`, `js-cookie`, and nested `uuid` advisories have no compatible published fix in that tree. The integration is dynamically loaded only when enabled, but this is not a claim that the advisories are harmless. Upgrade after an official compatible release is tested.

## Git and GitHub blocker

The original Git metadata was absent. The workspace and two parent levels contained no recoverable `.git`, reflog, remote, sibling Continuity checkout, or matching archive. A new repository was therefore initialized for one honest baseline snapshot; no synthetic development history was created.

The single baseline commit is created after all local gates pass. Before submission, publish it, then verify:

```bash
git status --short
git log --oneline --decorate --graph --all
git remote -v
git ls-remote --get-url origin
```

Use one truthful subject such as `feat: establish Continuity hackathon baseline`. Do not create empty commits or split the snapshot to imitate historical development.

Confirm the actual GitHub repository is public in GitHub's repository settings and from an unauthenticated browser. No GitHub connection is available in this workspace, so that final check remains external.

## Files intentionally kept outside submission

`.continuity-demo/` contains ignored Sibyl verification databases from real local evidence runs. They are preserved locally so evidence is not destroyed, but `.gitignore` and `.dockerignore` prevent them from entering Git or the production image. Reproducible `.sibyl-demo-venv/`, `node_modules/`, and `dist/` directories are ignored and are not staged.
