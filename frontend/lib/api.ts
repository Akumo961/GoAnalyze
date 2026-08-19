/**
 * Centralized API client for the GoAnalyze FastAPI backend.
 *
 * Every call here maps to exactly one endpoint that exists in
 * /openapi_export.json. Nothing here calls an endpoint that isn't real --
 * if a page needs data with no backing endpoint, that's tracked in
 * FRONTEND_BACKEND_GAPS.md, not faked here.
 */

import { config } from "./config";
import { getValidAccessToken } from "./auth";
import type {
  AuditEventListResponse,
  DocumentIngestRequest,
  DocumentProcessingResult,
  DocumentRecord,
  EnvironmentalReviewRequest,
  EnvironmentalReviewResponse,
  EvidenceCitation,
  CaseAssignResponse,
  HealthResponse,
  HTTPValidationError,
  MetricsResponse,
  RagAnswerResponse,
  ReadyResponse,
  SearchParams,
  SearchResponse,
  SetupConfiguration,
  SetupConfigurationResult
} from "./types";

export class ApiError extends Error {
  status: number;
  kind: "unauthorized" | "forbidden" | "validation" | "not_found" | "server" | "network" | "timeout" | "unknown";
  validation?: HTTPValidationError;
  body?: unknown;

  constructor(
    message: string,
    status: number,
    kind: ApiError["kind"],
    opts?: { validation?: HTTPValidationError; body?: unknown }
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.validation = opts?.validation;
    this.body = opts?.body;
  }
}

function kindForStatus(status: number): ApiError["kind"] {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Set false for endpoints that don't require the Authorization header. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.replace(/^\//, ""), config.apiBaseUrl.replace(/\/?$/, "/"));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, json, body, headers = {}, authenticated = true, signal } = options;

  const finalHeaders: Record<string, string> = { Accept: "application/json", ...headers };
  if (json !== undefined) finalHeaders["Content-Type"] = "application/json";

  if (authenticated) {
    const token = await getValidAccessToken();
    if (token) {
      finalHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);
  const combinedSignal = signal ?? controller.signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: combinedSignal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `Request to ${path} timed out after ${config.apiTimeoutMs}ms.`,
        0,
        "timeout"
      );
    }
    throw new ApiError(
      `Could not reach the GoAnalyze API at ${config.apiBaseUrl}. Check that the backend is running and reachable.`,
      0,
      "network"
    );
  }
  clearTimeout(timeout);

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    const kind = kindForStatus(response.status);
    if (kind === "validation" && isJson) {
      const validation = (await response.json()) as HTTPValidationError;
      const firstMsg = validation.detail?.[0]?.msg;
      throw new ApiError(
        firstMsg ? `Validation error: ${firstMsg}` : "The request was rejected as invalid.",
        response.status,
        "validation",
        { validation }
      );
    }
    let bodyText: unknown = undefined;
    try {
      bodyText = isJson ? await response.json() : await response.text();
    } catch {
      /* ignore */
    }
    const messages: Record<ApiError["kind"], string> = {
      unauthorized: "Your session has expired or you are not signed in.",
      forbidden: "You don't have permission to perform this action.",
      not_found: "The requested resource was not found.",
      validation: "The request was rejected as invalid.",
      server: "The GoAnalyze API encountered an internal error. Please try again shortly.",
      network: "Network error contacting the GoAnalyze API.",
      timeout: "The request timed out.",
      unknown: `Request failed with status ${response.status}.`
    };
    throw new ApiError(messages[kind], response.status, kind, { body: bodyText });
  }

  if (response.status === 204) return undefined as T;
  if (!isJson) return (await response.blob()) as unknown as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export const systemApi = {
  health: () => request<HealthResponse>("/health", { authenticated: false }),
  ready: () => request<ReadyResponse>("/ready", { authenticated: false }),
  metrics: () => request<MetricsResponse>("/metrics", { authenticated: false })
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentsApi = {
  ingest: (payload: DocumentIngestRequest) =>
    request<DocumentRecord>("/v1/documents", { method: "POST", json: payload }),

  uploadContent: (documentId: string, file: File) =>
    request<Record<string, unknown>>(`/v1/documents/${documentId}/content`, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" }
    }),

  process: (documentId: string) =>
    request<DocumentProcessingResult>(`/v1/documents/${documentId}/process`, {
      method: "POST"
    }),

  search: (params: SearchParams) =>
    request<SearchResponse>("/v1/documents/search", {
      query: {
        q: params.q,
        page: params.page,
        page_size: params.page_size,
        classification: params.classification ?? undefined,
        content_type: params.content_type ?? undefined
      }
    }),

  downloadUrl: (documentId: string) =>
    buildUrl(`/v1/documents/${documentId}/download`),

  download: (documentId: string) =>
    request<Blob>(`/v1/documents/${documentId}/download`, { method: "GET" })
};

// ---------------------------------------------------------------------------
// RAG / AI Research
// ---------------------------------------------------------------------------

export const ragApi = {
  answer: (question: string, citations: EvidenceCitation[]) =>
    request<RagAnswerResponse>("/v1/rag/answer", {
      method: "POST",
      query: { question },
      json: citations
    })
};

// ---------------------------------------------------------------------------
// Environmental reviews
// ---------------------------------------------------------------------------

export const environmentalApi = {
  review: (payload: EnvironmentalReviewRequest) =>
    request<EnvironmentalReviewResponse>("/v1/environmental-reviews", {
      method: "POST",
      json: payload
    })
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const casesApi = {
  assign: (caseId: string, skill?: string) =>
    request<CaseAssignResponse>(`/v1/cases/${caseId}/assign`, {
      method: "POST",
      query: { skill }
    })
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditApi = {
  list: (page = 1, pageSize = 20) =>
    request<AuditEventListResponse>("/v1/audit", {
      query: { page, page_size: pageSize }
    })
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export const setupApi = {
  submit: (payload: SetupConfiguration) =>
    request<SetupConfigurationResult>("/v1/setup", {
      method: "POST",
      json: payload,
      authenticated: false
    })
};

export { buildUrl as apiUrl };
