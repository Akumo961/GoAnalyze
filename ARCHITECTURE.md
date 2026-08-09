# Target Architecture

## Logical Architecture

```mermaid
flowchart LR
  U["Ministry users"] --> WAF["Zero-trust gateway / WAF"]
  WAF --> FE["Next.js TypeScript console"]
  FE --> API["FastAPI platform API"]
  API --> KC["Keycloak SSO/MFA"]
  API --> PG["PostgreSQL tenant data"]
  API --> OS["OpenSearch hybrid/vector search"]
  API --> MINIO["MinIO object storage"]
  API --> REDIS["Redis cache/idempotency"]
  API --> KAFKA["Kafka event bus"]
  KAFKA --> WORKERS["OCR/AI/workflow workers"]
  WORKERS --> TEMPORAL["Temporal workflows"]
  WORKERS --> OS
  WORKERS --> MINIO
  WORKERS --> PG
  API --> OTEL["OpenTelemetry"]
  OTEL --> OBS["Prometheus / Grafana / Loki"]
```

## Data Flow

```mermaid
sequenceDiagram
  participant User
  participant Frontend
  participant API
  participant Keycloak
  participant MinIO
  participant Kafka
  participant Worker
  participant OpenSearch
  participant Temporal
  participant Audit

  User->>Frontend: Upload or review document
  Frontend->>Keycloak: OIDC login with MFA
  Frontend->>API: Authenticated request with tenant claims
  API->>MinIO: Store immutable object
  API->>Audit: Append document.ingested event
  API->>Kafka: Publish document.ingested
  Kafka->>Worker: Consume ingestion event
  Worker->>Temporal: Start classification workflow
  Worker->>OpenSearch: Index text, vectors, metadata
  Worker->>Audit: Append extraction and AI events
```

## Security Architecture

```mermaid
flowchart TB
  IDP["Keycloak: SSO, MFA, OIDC"] --> JWT["Signed access token"]
  JWT --> API["FastAPI token validation"]
  API --> RBAC["Realm/client roles"]
  API --> ABAC["Tenant, classification, purpose, ministry attributes"]
  ABAC --> DATA["Tenant-scoped data access"]
  API --> AUDIT["Hash-chained audit events"]
  DATA --> ENC["Encryption at rest and tenant-aware key policy"]
```

## Deployment Architecture

```mermaid
flowchart LR
  subgraph Cluster["Kubernetes cluster"]
    ING["Ingress"]
    FE["Frontend replicas"]
    API["API replicas"]
    WK["Worker replicas"]
    OBS["Observability agents"]
  end
  ING --> FE --> API --> WK
  API --> PG["PostgreSQL HA"]
  API --> REDIS["Redis HA"]
  API --> OS["OpenSearch cluster"]
  WK --> MINIO["MinIO/S3 HA"]
  WK --> KAFKA["Kafka cluster"]
  WK --> TEMP["Temporal cluster"]
```

## AI Architecture

```mermaid
flowchart TB
  OCR["OCR extraction"] --> CHUNK["Chunking with page/offset hashes"]
  CHUNK --> CLASSIFY["Document classification"]
  CHUNK --> ENTITY["Entity extraction"]
  CHUNK --> VECTOR["Embedding generation"]
  VECTOR --> SEARCH["Hybrid vector + BM25 retrieval"]
  SEARCH --> RAG["Grounded answer generation"]
  RAG --> CHECK["Hallucination and citation checks"]
  CHECK --> REVIEW["Human review workflow"]
```

## Integration Architecture

- Keycloak provides SSO, MFA, role mapping, and tenant claims.
- Kafka carries document, audit, workflow, and notification events.
- Temporal coordinates ingestion, OCR, classification, review, SLA, and escalation workflows.
- PostgreSQL stores tenant metadata, cases, workflow state, audit event envelopes, and lineage.
- MinIO stores immutable binaries, OCR artifacts, model outputs, and evidence bundles.
- OpenSearch provides keyword, metadata, and vector retrieval.
- Prometheus, Grafana, Loki, and OpenTelemetry provide metrics, dashboards, logs, and traces.

