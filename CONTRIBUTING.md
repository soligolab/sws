# Contributing to SWS

Thank you for your interest in contributing to Soligo Web SCADA.

## Licensing of contributions: DCO + CLA

SWS is dual licensed, AGPL-3.0-only or a commercial license (see [LICENSING.md](LICENSING.md)). To be able to offer
both, the copyright holder needs the right to distribute every contribution under either license. So, from
2026-11-10, every external contribution needs **both** of the following.

### 1. Developer Certificate of Origin (DCO)

Every commit must include a `Signed-off-by:` trailer:

```
Signed-off-by: Your Name <your@email.com>
```

Use `git commit -s` to add it automatically. By signing off you certify that you wrote the
code or have the right to submit it under the project licenses (AGPL-3.0-only, and the commercial
license through the CLA below). See [developercertificate.org](https://developercertificate.org/).

### 2. Contributor License Agreement (CLA)

Before your first pull request is merged, you agree to the [Individual CLA](CLA.md): you keep the
copyright on your work and grant the project a broad license to use it, also under the commercial
license. The CLA explains how to sign: one sentence in the description of your first pull request.
It covers all your later contributions too.

## Branch Naming

| Prefix | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `chore/` | Tooling, CI, dependencies |

Example: `feat/modbus-tcp-plugin`

## Pull Request Requirements

1. **Description**: clearly explain what and why.
2. **Related issue**: link with `Closes #NNN` if applicable.
3. **CHANGELOG**: add an entry under `[Unreleased]` in `CHANGELOG.md`.
4. **Tests**: all existing tests must pass; new behaviour must have tests.
5. **DCO + CLA**: every commit in the PR must have `Signed-off-by:`, and the author has signed the [CLA](CLA.md).
6. **Review**: at least one maintainer approval before merge.

Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it is loaded automatically.

## Running Tests Locally

### Runtime (Rust)

```bash
cd sws-runtime
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace
cargo audit
```

### Editor (TypeScript)

```bash
cd sws-editor
pnpm install
pnpm lint
pnpm type-check
pnpm test
```

## Coding Standards

- **Rust**: follow `rustfmt` defaults; no `unsafe` without `// SAFETY:` justification.
- **TypeScript**: strict mode enforced; no `any` without a comment explaining why.
- **Comments**: explain *why*, not *what*. Prefer self-documenting names.
- **HTTPS-only**: never introduce plain HTTP paths.
- **No default credentials**: never hard-code passwords or secrets.
