/**
 * Types mirrored 1:1 from /openapi_export.json (backend contract).
 *
 * Do not "improve" these by adding fields the API doesn't return -- every
 * field here was verified against the exported OpenAPI schema. If the UI
 * needs something the API doesn't expose yet, that need is tracked in
 * FRONTEND_BACKEND_GAPS.md instead of being invented here.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ClassificationLevel =
  | "public"
  | "internal"
  | "confidential"
  | "protected_b";

export const CLASSIFICATION_LEVELS: ClassificationLevel[] = [
  "public",
  "internal",
  "confidential",
  "protected_b"
];

export type IdentityProvider = "keycloak" | "azure_ad" | "microsoft_entra_id";

/**
 * The backend's PipelineStage enum wasn't resolvable to a fixed literal
 * union from the exported schema (open string in practice), so we type it
 * as string but keep the canonical, documented pipeline order here for the
 * UI to render a stable pipeline diagram regardless of what the API
 * actually returns for a given document.
 */
export type PipelineStageName = string;

export const CANONICAL_PIPELINE_STAGES: PipelineStageName[] = [
  "ocr",
  "classification",
  "metadata_extraction",
  "entity_extraction",
  "compliance_analysis",
  "risk_scoring",
  "vector_indexing",
  "workflow_routing",
  "audit"
];

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface DocumentIngestRequest {
  tenant_id: string;
  case_id?: string | null;
  filename: string;
  content_type: string;
  classification?: ClassificationLevel;
  sha256: string;
  object_uri: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentRecord {
  tenant_id: string;
  case_id?: string | null;
  filename: string;
  content_type: string;
  classification: ClassificationLevel;
  sha256: string;
  object_uri: string;
  metadata: Record<string, unknown>;
  id: string;
  version: number;
  lineage_id: string;
  created_at: string;
}

export interface StageResult {
  stage: PipelineStageName;
  status: string;
  output: Record<string, unknown>;
  duration_ms: number;
}

export interface DocumentProcessingResult {
  document_id: string;
  stages: StageResult[];
  classification_label?: string | null;
  extracted_entities: string[];
  risk_score?: number | null;
  workflow_queue?: string | null;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  document_id: string;
  filename: string;
  content_type: string;
  classification: ClassificationLevel;
  score: number;
  highlight?: string | null;
  created_at: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  page: number;
  page_size: number;
  backend: string;
  results: SearchHit[];
}

export interface SearchParams {
  q?: string;
  page?: number;
  page_size?: number;
  classification?: ClassificationLevel | string | null;
  content_type?: string | null;
}

// ---------------------------------------------------------------------------
// RAG / AI Research
// ---------------------------------------------------------------------------

export interface EvidenceCitation {
  document_id: string;
  version: number;
  chunk_id: string;
  page?: number | null;
  start_offset?: number | null;
  end_offset?: number | null;
  sha256: string;
  excerpt: string;
}

/**
 * The backend declares its RAG response as `additionalProperties: true`
 * (an open object) rather than a fixed schema. We treat known-likely keys
 * as optional and preserve the rest so nothing is silently dropped.
 */
export interface RagAnswerResponse {
  answer?: string;
  citations?: EvidenceCitation[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Environmental reviews
// ---------------------------------------------------------------------------

export interface EnvironmentalReviewRequest {
  tenant_id: string;
  case_id: string;
  project_type: string;
  location: string;
  applicant: string;
  documents: string[];
  attributes?: Record<string, unknown>;
}

/** Open object per the backend schema -- see RagAnswerResponse note above. */
export interface EnvironmentalReviewResponse {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** Open object per the backend schema. */
export interface CaseAssignResponse {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  tenant_id: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string;
  purpose: string;
  trace_id: string;
  timestamp: string;
  details: Record<string, unknown>;
  previous_hash?: string | null;
  event_hash?: string | null;
}

export interface AuditEventListResponse {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: AuditEvent[];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface SetupConfiguration {
  postgresql_url: string;
  minio_endpoint: string;
  minio_access_key?: string | null;
  opensearch_url: string;
  redis_url: string;
  identity_provider: IdentityProvider;
  keycloak_issuer?: string | null;
  azure_ad_tenant_id?: string | null;
  azure_ad_client_id?: string | null;
  microsoft_entra_id_tenant_id?: string | null;
  ocr_engine: string;
  ai_provider: string;
  ai_provider_endpoint?: string | null;
  object_storage_bucket: string;
  email_notifications_enabled?: boolean;
  email_smtp_host?: string | null;
  email_from_address?: string | null;
}

export interface SetupConfigurationResult {
  accepted: boolean;
  validated_components: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// System / health
// ---------------------------------------------------------------------------

export type HealthResponse = Record<string, string>;
/** /ready and /metrics have no fixed schema in the OpenAPI export (`{}`). */
export type ReadyResponse = Record<string, unknown>;
export type MetricsResponse = Record<string, unknown> | string;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}
