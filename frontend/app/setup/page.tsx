
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Database,
  HardDrive,
  KeyRound,
  Mail,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Zap
} from "lucide-react";

type IdentityProvider = "keycloak" | "azure_ad" | "microsoft_entra_id";

interface WizardState {
  postgresqlUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  opensearchUrl: string;
  redisUrl: string;
  identityProvider: IdentityProvider;
  keycloakIssuer: string;
  azureAdTenantId: string;
  azureAdClientId: string;
  entraIdTenantId: string;
  ocrEngine: string;
  aiProvider: string;
  aiProviderEndpoint: string;
  objectStorageBucket: string;
  emailNotificationsEnabled: boolean;
  emailSmtpHost: string;
  emailFromAddress: string;
}

interface SetupResponse {
  accepted: boolean;
  validated_components: string[];
  warnings: string[];
}

type StepId =
  | "database"
  | "storage"
  | "search"
  | "cache"
  | "identity"
  | "ocr"
  | "ai"
  | "notifications"
  | "review";

interface StepDefinition {
  id: StepId;
  label: string;
  icon: typeof Database;
}

const SETUP_COMPLETED_KEY = "goanalyze_setup_completed";
const SETUP_REQUEST_TIMEOUT_MS = 20000;
const REDIRECT_DELAY_MS = 1200;
const DEFAULT_API_BASE = "http://localhost:8080";

const DEFAULT_STATE: WizardState = {
  postgresqlUrl: "postgresql+asyncpg://goanalyze:goanalyze@postgres:5432/goanalyze",
  minioEndpoint: "minio:9000",
  minioAccessKey: "goanalyze",
  opensearchUrl: "http://opensearch:9200",
  redisUrl: "redis://redis:6379/0",
  identityProvider: "keycloak",
  keycloakIssuer: "http://keycloak:8080/realms/goanalyze",
  azureAdTenantId: "",
  azureAdClientId: "",
  entraIdTenantId: "",
  ocrEngine: "tesseract",
  aiProvider: "openai-compatible",
  aiProviderEndpoint: "",
  objectStorageBucket: "goanalyze-documents",
  emailNotificationsEnabled: false,
  emailSmtpHost: "",
  emailFromAddress: ""
};

const STEPS: StepDefinition[] = [
  { id: "database", label: "PostgreSQL", icon: Database },
  { id: "storage", label: "MinIO & Object Storage", icon: HardDrive },
  { id: "search", label: "OpenSearch", icon: Search },
  { id: "cache", label: "Redis", icon: Zap },
  { id: "identity", label: "Identity Provider", icon: KeyRound },
  { id: "ocr", label: "OCR Engine", icon: Server },
  { id: "ai", label: "AI Provider", icon: Sparkles },
  { id: "notifications", label: "Email Notifications", icon: Mail },
  { id: "review", label: "Review & Finish", icon: ShieldCheck }
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSetupResponse(value: unknown): value is SetupResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accepted === "boolean" &&
    isStringArray(candidate.validated_components) &&
    isStringArray(candidate.warnings)
  );
}

function readSetupCompletedFlag(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SETUP_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSetupCompletedFlag(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SETUP_COMPLETED_KEY, "true");
  } catch {
    // Storage may be unavailable (private browsing, disabled storage, quota exceeded).
    // Non-fatal: navigation still proceeds.
  }
}

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_GOV_API_URL ?? DEFAULT_API_BASE;
}

export default function SetupWizardPage() {
  const router = useRouter();

  const [hasMounted, setHasMounted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [result, setResult] = useState<SetupResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    // Client-only mount flag: required to avoid an SSR/CSR markup mismatch,
    // since whether we've mounted can't be known during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (readSetupCompletedFlag()) {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current !== null) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, []);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  const update = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const summary = useMemo(
    () => [
      { label: "PostgreSQL", value: state.postgresqlUrl },
      { label: "MinIO endpoint", value: state.minioEndpoint },
      { label: "OpenSearch", value: state.opensearchUrl },
      { label: "Redis", value: state.redisUrl },
      { label: "Identity provider", value: state.identityProvider },
      { label: "OCR engine", value: state.ocrEngine },
      { label: "AI provider", value: state.aiProvider },
      { label: "Object storage bucket", value: state.objectStorageBucket },
      { label: "Email notifications", value: state.emailNotificationsEnabled ? "Enabled" : "Disabled" }
    ],
    [state]
  );

  const handleFinish = useCallback(async () => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SETUP_REQUEST_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await fetch(`${getApiBase()}/v1/setup`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            postgresql_url: state.postgresqlUrl,
            minio_endpoint: state.minioEndpoint,
            minio_access_key: state.minioAccessKey || null,
            opensearch_url: state.opensearchUrl,
            redis_url: state.redisUrl,

            identity_provider: state.identityProvider,
            keycloak_issuer: state.keycloakIssuer || null,

            azure_ad_tenant_id: state.azureAdTenantId || null,
            azure_ad_client_id: state.azureAdClientId || null,
            microsoft_entra_id_tenant_id: state.entraIdTenantId || null,

            ocr_engine: state.ocrEngine,

            ai_provider: state.aiProvider,
            ai_provider_endpoint: state.aiProviderEndpoint || null,

            object_storage_bucket: state.objectStorageBucket,

            email_notifications_enabled: state.emailNotificationsEnabled,
            email_smtp_host: state.emailSmtpHost || null,
            email_from_address: state.emailFromAddress || null
          })
        });
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          setError("Setup request timed out. Verify backend connectivity and try again.");
        } else {
          setError("Unable to reach the setup API. Check your network connection and try again.");
        }
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await response.json();
      } catch {
        setError(`Setup API returned an invalid response (status ${response.status}).`);
        return;
      }

      if (!response.ok) {
        const warningsPart =
          isSetupResponse(rawBody) && rawBody.warnings.length > 0
            ? ` Details: ${rawBody.warnings.join(", ").replaceAll("_", " ")}`
            : "";
        setError(`Setup failed (HTTP ${response.status}).${warningsPart}`);
        return;
      }

      if (!isSetupResponse(rawBody)) {
        setError("Setup API returned an unexpected response format.");
        return;
      }

      setResult(rawBody);

      if (rawBody.accepted) {
        writeSetupCompletedFlag();

        redirectTimeoutRef.current = setTimeout(() => {
          router.push("/");
        }, REDIRECT_DELAY_MS);
      }
    } finally {
      clearTimeout(timeoutId);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [router, state]);

  if (!hasMounted) {
    return null;
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Standalone platform setup</p>
          <h1>Enterprise Configuration Wizard</h1>
        </div>
      </header>

      <section className="wizardLayout">
        <nav className="wizardSteps" aria-label="Setup steps">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === stepIndex;
            return (
              <button
                key={s.id}
                type="button"
                className={`wizardStepButton${isActive ? " active" : ""}${idx < stepIndex ? " done" : ""}`}
                onClick={() => setStepIndex(idx)}
                aria-current={isActive ? "step" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="wizardPanel">
          {step.id === "database" && (
            <Field label="PostgreSQL connection URL" hint="Used for tenant, case, and workflow data." htmlFor="postgresqlUrl">
              <input
                id="postgresqlUrl"
                name="postgresqlUrl"
                type="text"
                autoComplete="off"
                required
                value={state.postgresqlUrl}
                onChange={(e) => update("postgresqlUrl", e.target.value)}
                placeholder="postgresql+asyncpg://user:password@host:5432/db"
              />
            </Field>
          )}

          {step.id === "storage" && (
            <>
              <Field
                label="MinIO endpoint"
                hint="Host:port for the MinIO / S3-compatible object storage."
                htmlFor="minioEndpoint"
              >
                <input
                  id="minioEndpoint"
                  name="minioEndpoint"
                  type="text"
                  autoComplete="off"
                  required
                  value={state.minioEndpoint}
                  onChange={(e) => update("minioEndpoint", e.target.value)}
                />
              </Field>
              <Field label="MinIO access key" htmlFor="minioAccessKey">
                <input
                  id="minioAccessKey"
                  name="minioAccessKey"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={state.minioAccessKey}
                  onChange={(e) => update("minioAccessKey", e.target.value)}
                />
              </Field>
              <Field
                label="Object storage bucket"
                hint="Bucket used for immutable original document storage."
                htmlFor="objectStorageBucket"
              >
                <input
                  id="objectStorageBucket"
                  name="objectStorageBucket"
                  type="text"
                  autoComplete="off"
                  required
                  value={state.objectStorageBucket}
                  onChange={(e) => update("objectStorageBucket", e.target.value)}
                />
              </Field>
            </>
          )}

          {step.id === "search" && (
            <Field label="OpenSearch URL" hint="Powers hybrid keyword + vector document search." htmlFor="opensearchUrl">
              <input
                id="opensearchUrl"
                name="opensearchUrl"
                type="text"
                autoComplete="off"
                required
                value={state.opensearchUrl}
                onChange={(e) => update("opensearchUrl", e.target.value)}
              />
            </Field>
          )}

          {step.id === "cache" && (
            <Field label="Redis URL" hint="Used for caching and request idempotency." htmlFor="redisUrl">
              <input
                id="redisUrl"
                name="redisUrl"
                type="text"
                autoComplete="off"
                required
                value={state.redisUrl}
                onChange={(e) => update("redisUrl", e.target.value)}
              />
            </Field>
          )}

          {step.id === "identity" && (
            <>
              <Field label="Identity provider" htmlFor="identityProvider">
                <select
                  id="identityProvider"
                  name="identityProvider"
                  value={state.identityProvider}
                  onChange={(e) => update("identityProvider", e.target.value as IdentityProvider)}
                >
                  <option value="keycloak">Keycloak</option>
                  <option value="azure_ad">Azure AD</option>
                  <option value="microsoft_entra_id">Microsoft Entra ID</option>
                </select>
              </Field>
              {state.identityProvider === "keycloak" && (
                <Field label="Keycloak realm issuer URL" htmlFor="keycloakIssuer">
                  <input
                    id="keycloakIssuer"
                    name="keycloakIssuer"
                    type="text"
                    autoComplete="off"
                    required
                    value={state.keycloakIssuer}
                    onChange={(e) => update("keycloakIssuer", e.target.value)}
                  />
                </Field>
              )}
              {state.identityProvider === "azure_ad" && (
                <>
                  <Field label="Azure AD tenant ID" htmlFor="azureAdTenantId">
                    <input
                      id="azureAdTenantId"
                      name="azureAdTenantId"
                      type="text"
                      autoComplete="off"
                      required
                      value={state.azureAdTenantId}
                      onChange={(e) => update("azureAdTenantId", e.target.value)}
                    />
                  </Field>
                  <Field label="Azure AD application (client) ID" htmlFor="azureAdClientId">
                    <input
                      id="azureAdClientId"
                      name="azureAdClientId"
                      type="text"
                      autoComplete="off"
                      required
                      value={state.azureAdClientId}
                      onChange={(e) => update("azureAdClientId", e.target.value)}
                    />
                  </Field>
                </>
              )}
              {state.identityProvider === "microsoft_entra_id" && (
                <Field label="Microsoft Entra ID tenant ID" htmlFor="entraIdTenantId">
                  <input
                    id="entraIdTenantId"
                    name="entraIdTenantId"
                    type="text"
                    autoComplete="off"
                    required
                    value={state.entraIdTenantId}
                    onChange={(e) => update("entraIdTenantId", e.target.value)}
                  />
                </Field>
              )}
            </>
          )}

          {step.id === "ocr" && (
            <Field label="OCR engine" hint="Extracts text from uploaded documents before classification." htmlFor="ocrEngine">
              <select id="ocrEngine" name="ocrEngine" value={state.ocrEngine} onChange={(e) => update("ocrEngine", e.target.value)}>
                <option value="tesseract">Tesseract (self-hosted)</option>
                <option value="paddleocr">PaddleOCR (self-hosted)</option>
                <option value="azure-document-intelligence">Azure AI Document Intelligence</option>
                <option value="aws-textract">Amazon Textract</option>
                <option value="google-document-ai">Google Document AI</option>
              </select>
            </Field>
          )}

          {step.id === "ai" && (
            <>
              <Field
                label="AI provider"
                hint="Used for classification, entity extraction, and grounded RAG answers."
                htmlFor="aiProvider"
              >
                <select id="aiProvider" name="aiProvider" value={state.aiProvider} onChange={(e) => update("aiProvider", e.target.value)}>
                  <option value="openai-compatible">OpenAI-compatible API</option>
                  <option value="azure-openai">Azure OpenAI</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="self-hosted">Self-hosted model (Ollama / vLLM)</option>
                </select>
              </Field>
              <Field
                label="AI provider endpoint"
                hint="Optional override for self-hosted or regional endpoints."
                htmlFor="aiProviderEndpoint"
              >
                <input
                  id="aiProviderEndpoint"
                  name="aiProviderEndpoint"
                  type="text"
                  autoComplete="off"
                  value={state.aiProviderEndpoint}
                  onChange={(e) => update("aiProviderEndpoint", e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            </>
          )}

          {step.id === "notifications" && (
            <>
              <Field label="Enable email notifications" htmlFor="emailNotificationsEnabled">
                <label className="toggleRow">
                  <input
                    id="emailNotificationsEnabled"
                    name="emailNotificationsEnabled"
                    type="checkbox"
                    checked={state.emailNotificationsEnabled}
                    onChange={(e) => update("emailNotificationsEnabled", e.target.checked)}
                  />
                  <span>Send case and workflow notifications by email</span>
                </label>
              </Field>
              {state.emailNotificationsEnabled && (
                <>
                  <Field label="SMTP host" htmlFor="emailSmtpHost">
                    <input
                      id="emailSmtpHost"
                      name="emailSmtpHost"
                      type="text"
                      autoComplete="off"
                      required
                      value={state.emailSmtpHost}
                      onChange={(e) => update("emailSmtpHost", e.target.value)}
                    />
                  </Field>
                  <Field label="From address" htmlFor="emailFromAddress">
                    <input
                      id="emailFromAddress"
                      name="emailFromAddress"
                      type="email"
                      autoComplete="off"
                      required
                      value={state.emailFromAddress}
                      onChange={(e) => update("emailFromAddress", e.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          )}

          {step.id === "review" && (
            <div className="reviewStep">
              <h2>Review configuration</h2>
              <dl className="summaryList">
                {summary.map((item) => (
                  <div key={item.label} className="summaryRow">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>

              {error && (
                <p role="alert" className="wizardError">
                  {error}
                </p>
              )}

              {result && (
                <div className="wizardResult" role="status">
                  <p>{result.accepted ? "Configuration accepted." : "Configuration submitted with warnings."}</p>
                  {result.warnings.length > 0 && (
                    <ul>
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning.replaceAll("_", " ")}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button type="button" className="primaryButton" onClick={handleFinish} disabled={submitting}>
                {submitting ? "Submitting..." : "Finish setup"}
              </button>
            </div>
          )}

          <nav className="wizardNav">
            <button type="button" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={isFirst}>
              Back
            </button>
            {!isLast && (
              <button
                type="button"
                className="primaryButton"
                onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
              >
                Next
              </button>
            )}
          </nav>
        </div>
      </section>
    </main>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}

function Field({ label, hint, htmlFor, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small className="fieldHint">{hint}</small>}
    </div>
  );
}