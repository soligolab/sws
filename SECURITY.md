# Security Policy

SWS is made by **Soligonet**, which acts as the manufacturer under the EU Cyber Resilience Act.

## Supported versions

Security fixes are provided for the **latest release only**, for **5 years from the date of the latest release**.
Panels receive updates automatically by default (`AutoUpdate=registry`), with a snapshot and rollback.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use one of these channels:

1. **GitHub private vulnerability reporting** (preferred):
   <https://github.com/soligolab/sws/security/advisories/new>
2. **Email**: `security@soligo.net` (no PGP key: use GitHub if you need a confidential channel with attachments).

The same contacts are published by every SWS runtime at `/.well-known/security.txt` (RFC 9116).

### What to include

- the affected component and version (`sws-runtime`, `sws-editor`, container image tag, panel model);
- a description of the vulnerability and its impact;
- steps to reproduce or a proof of concept;
- any mitigation you know of.

Reports may be written in **Italian or English**.

## What happens next

| When | What |
|---|---|
| within **3 business days** | we acknowledge the report |
| within **10 business days** | first assessment: confirmed or not, severity, expected timeline |
| within **90 days** | a fix or mitigation is released (sooner for actively exploited issues) |

We credit reporters in the advisory unless they ask to stay anonymous.

Actively exploited vulnerabilities and severe incidents are also notified to the authorities within the deadlines
of Article 14 of the Cyber Resilience Act (24 hours, 72 hours, final report).

## Advisories

Security advisories are published as **GitHub Security Advisories**:
<https://github.com/soligolab/sws/security/advisories>

They are distinct from the release notes shown on the panel before an update.

## Scope

In scope: `sws-runtime`, `sws-editor`, `sws-lvgl-viewer`, the official container images, the installers and quadlets,
the CI pipeline, the project YAML format, the cloud IDE and the panel tunnel.

Out of scope: third-party dependencies (report those upstream; we will update), demo and template projects as
content, issues that need physical access to an unlocked panel.
