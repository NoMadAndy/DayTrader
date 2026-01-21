# Copilot Repository Instructions (apply to every request)

## Non-negotiables
- Never commit secrets. Configuration must come from env/.env; document every variable in `.env.example` (no real values).
- Preserve multi-user + multi-tenant isolation: every data access must be tenant-scoped; no cross-tenant reads/writes.
- Security by default: validate inputs, safe error handling, no secret/PII in logs, least privilege.

## Definition of Done (for every code change)
- Update README if behavior/setup/config/deploy changed. If not, say why (one sentence).
- Update CHANGELOG for user-visible changes (features, fixes, breaking changes). If not, say why (one sentence).
- Ensure “current build info” is visible in the app (UI or endpoint/command): version + commit/revision + build time.
- Keep checks green; add tests for new behavior.
- Document any new settings in `.env.example`.

## Versioning & commits (SemVer-friendly)
- Use conventional commit style: feat/fix/docs/chore/refactor/test/ci/build.
- Mark breaking changes explicitly (feat!/fix! or BREAKING CHANGE).

## Preprod deployment (tool-agnostic contract)
- After merge/release, preprod updates automatically, is idempotent, and supports rollback.

## If AI/ML is involved
- CPU path must always work.
- GPU/CUDA is opt-in and documented (runtime/driver/container notes).

## When you respond with changes
End with:
- What changed (≤5 bullets)
- Which meta files updated (README/CHANGELOG/.env.example/build info)
- Where build/version is visible
- Deploy note (what happens after merge/release)
