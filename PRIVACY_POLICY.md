# Privacy Policy

GoAnalyze is a self-hosted, standalone AI document intelligence platform. This policy describes how the platform itself handles data. It does not govern any third-party system, since GoAnalyze has no dependency on or integration with any external document management product.

## Data Controller

The deploying organization (ministry, agency, or enterprise) is the data controller for all documents, metadata, and audit events processed by its GoAnalyze deployment. Anthropic-style hosted defaults do not apply — GoAnalyze runs entirely within infrastructure the deploying organization controls (PostgreSQL, MinIO/object storage, OpenSearch, Redis, and identity provider of the organization's choosing).

## Data We Process

- **Uploaded documents and derived artifacts** — original files, OCR text, extracted entities, classifications, embeddings, and compliance/risk findings.
- **Case and workflow data** — review assignments, decisions, SLA state, and escalation history.
- **Audit events** — actor, action, resource, purpose-of-use, timestamp, and hash chain for every access and change.
- **Identity claims** — tenant, ministry, role, and classification attributes supplied by the configured identity provider (Keycloak, Azure AD, or Microsoft Entra ID).

## Data Storage and Retention

All data is stored in infrastructure operated by the deploying organization: PostgreSQL for structured/tenant data, MinIO or equivalent object storage for binaries, and OpenSearch for search and vector indexes. Retention and disposition schedules are configured per tenant/ministry policy; GoAnalyze does not transmit document content to Anthropic or any third party as part of normal platform operation.

## AI Processing

Document classification, entity extraction, compliance analysis, and retrieval-augmented generation are performed using the AI provider configured by the deploying organization during setup. Organizations may choose a locally hosted model or an external API-based provider; this choice determines whether any content leaves the organization's infrastructure.

## Access Control and Audit

Access to documents and case data is governed by attribute-based access control (tenant, ministry, classification, and purpose-of-use). Every access and action is recorded in an append-only, hash-chained audit log for accountability and compliance review.

## Contact

Questions about a specific deployment's data handling should be directed to that deployment's system owner, not to the GoAnalyze project maintainers, since the deploying organization is the data controller.
