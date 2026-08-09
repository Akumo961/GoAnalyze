# GoAnalyze — Government AI Document Intelligence Platform

GoAnalyze is a standalone, enterprise-grade AI document intelligence platform for government and public-sector organizations. It ingests documents, extracts text and meaning with OCR and AI, classifies and indexes them for retrieval, screens them for regulatory and compliance risk, and routes them through auditable review workflows — all with tenant isolation, attribute-based access control, and a hash-chained audit trail.

GoAnalyze has no dependency on any third-party document management system. It owns its full document lifecycle: storage, search, AI processing, workflow, and audit.

## Platform Capabilities

- **Ingestion pipeline** — Upload → OCR → Classification → Metadata Extraction → Entity Extraction → Compliance Analysis → Risk Scoring → Vector Indexing → Workflow Engine → Audit Logging.
- **Document search, upload, and download** — full-text search (OpenSearch, with automatic database fallback), original-file upload/download (MinIO, with automatic in-memory fallback), both tenant-isolated and audit-logged.
- **Evidence-grounded RAG** — hybrid keyword + vector retrieval with citations, source offsets, and confidence scores.
- **Environmental and regulatory review engine** — admissibility checks, regulation mapping, risk scoring, and recommendations.
- **Human review workflows** — case queues, assignments, SLA tracking, and escalation.
- **Immutable audit trail** — append-only, hash-chained audit events for every access and action.
- **Attribute-based access control** — tenant, ministry, classification, and purpose-of-use policies enforced on every request.
- **Enterprise identity** — Keycloak SSO/MFA, with support for Azure AD / Microsoft Entra ID federation.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for logical, data-flow, security, deployment, and AI architecture diagrams.

At a high level:

- **Frontend** — Next.js/TypeScript operator console (`frontend/`), including the enterprise configuration wizard and case/document review dashboard.
- **Platform API** — FastAPI service (`gov_platform/`) implementing ingestion, ABAC security, audit, RAG, workflow assignment, and the compliance/risk engine.
- **Data plane** — PostgreSQL (tenant and case data), OpenSearch (hybrid/vector search), MinIO (object storage), Redis (cache/idempotency).
- **Identity** — Keycloak, with Azure AD / Microsoft Entra ID federation.
- **Observability** — OpenTelemetry, Prometheus, Grafana, Loki.

## Getting Started

### Local stack (Docker Compose)

```bash
docker compose up --build
```

This starts the platform API, frontend console, PostgreSQL, Redis, OpenSearch, MinIO, Kafka, Temporal, Keycloak, and the observability stack (Prometheus, Grafana, Loki).

For a production-oriented topology (Nginx TLS termination, health-checked services, restart policies, resource limits), see `docker-compose.production.yml` and `Dockerfile.production`.

On first run, open the frontend console and complete the **Enterprise Configuration Wizard** to connect PostgreSQL, MinIO, OpenSearch, Redis, Keycloak (or Azure AD / Microsoft Entra ID), your OCR engine, your AI provider, object storage, and email notifications.

### Platform API only

```bash
pip install -e .
alembic upgrade head   # provisions schema against $GOV_DATABASE_URL
uvicorn gov_platform.main:app --reload
```

### Frontend only

```bash
cd frontend
npm install
npm run dev
```

### Running tests

```bash
python -m pytest -q
```

## Configuration

All configuration is environment-variable driven (see `gov_platform/config.py` for the full list of settings, and `.env.example` for a concrete template with every variable a deployment needs to set), prefixed with `GOV_`, or set interactively through the Enterprise Configuration Wizard in the frontend console. There is no dependency on any external document management system's API URL, token, username, or password.

## Deployment

- **Kubernetes / Helm** — see `helm/goanalyze-government/`.
- **Terraform** — see `terraform/`.
- **Docker Compose** — see `docker-compose.yml`.

## License

See [LICENSE](./LICENSE).
