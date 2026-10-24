// Auth is the httpOnly `wb_session` cookie (first-party via the Next.js /api rewrite) plus the
// X-CSRF-Token header on state-changing requests. The CSRF token comes from /api/me and lives in
// memory only; there is no bearer token in the browser.

export interface ApiErrorPayload {
  detail?: string | { msg?: string }[] | Record<string, unknown>;
  message?: string;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: ApiErrorPayload,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Endpoints that work without a session (and so without a CSRF token).
const NO_CSRF = ["/api/auth/login", "/api/auth/register"];

function toUrl(path: string) {
  if (path.startsWith("http") || path.startsWith("/api")) return path;
  return `/api${path.startsWith("/") ? "" : "/"}${path}`;
}

async function ensureCsrf(force = false): Promise<string | null> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) return null;
  csrfToken = ((await res.json()) as { csrf_token?: string }).csrf_token ?? null;
  return csrfToken;
}

async function send(url: string, init: RequestInit, retry: boolean): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const needsCsrf = UNSAFE.has(method) && !NO_CSRF.some((p) => url.startsWith(p));
  if (needsCsrf) {
    const token = await ensureCsrf();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const res = await fetch(url, { ...init, headers, credentials: "include" });
  if (needsCsrf && retry && res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (body?.detail === "csrf_failed" && (await ensureCsrf(true))) return send(url, init, false);
  }
  return res;
}

async function toError(response: Response): Promise<ApiError> {
  let payload: ApiErrorPayload | undefined;
  let errorMsg = `Request failed with status ${response.status}`;
  try {
    payload = await response.json();
    if (typeof payload?.detail === "string") {
      errorMsg = payload.detail;
    } else if (Array.isArray(payload?.detail) && payload.detail[0]?.msg) {
      errorMsg = payload.detail.map((d) => d.msg).join(", ");
    } else if (payload?.detail && typeof (payload.detail as { message?: unknown }).message === "string") {
      errorMsg = (payload.detail as { message: string }).message; // {reason, message} errors
    } else if (payload?.message) {
      errorMsg = payload.message;
    }
  } catch {
    // not JSON
  }
  return new ApiError(errorMsg, response.status, payload);
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(toUrl(path), init, true);
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

/** Human-readable message for an error thrown by apiFetch. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- Chat SSE (backend agent/pipeline.py) ----

export interface TraceEventData {
  step: number;
  label: string;
  name: string;
  status: "running" | "done" | string;
  ms?: number;
  summary?: string;
}

export interface CitationItem {
  id: string;
  type: string;
  title: string;
  container: string;
  url?: string | null;
  date?: string | null;
}

export interface ConflictClaim {
  value: string;
  citation_id: string;
  authority: string;
  date: string;
  source: string;
}

/** policy/conflict.py Resolution.as_dict */
export interface ConflictItem {
  topic: string;
  reason: string;
  chosen: ConflictClaim | null;
  competing: ConflictClaim[];
  unverified: ConflictClaim[];
  stale_doc_ids: string[];
}

/** policy/idk.py: offered when the answer lives in a gated topic the user can't read yet. */
export interface AccessOffer {
  topic_key: string;
  display_name: string;
}

export type DecisionPath = "answer" | "conflict" | "idk" | "policy_refusal" | "error";

export interface FinalEventData {
  query_id: string;
  conversation_id: string;
  answer: string;
  decision_path: DecisionPath;
  citations: CitationItem[];
  conflicts: ConflictItem[];
  stale_doc_ids: string[];
  access_offer: AccessOffer | null;
  notes: string[];
  action_draft_ids: string[];
  data_as_of: string | null;
  latency_ms: number;
}

export interface StreamHandlers {
  onTrace?: (data: TraceEventData) => void;
  onDelta?: (text: string) => void;
  onReplace?: (data: { answer: string; reason?: string }) => void;
  onFinal?: (data: FinalEventData) => void;
  onError?: (err: { message: string; query_id?: string }) => void;
  onClose?: () => void;
}

export function apiStream(path: string, body: unknown, handlers: StreamHandlers): { abort: () => void } {
  const controller = new AbortController();

  const run = async () => {
    try {
      const res = await send(toUrl(path), {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      }, true);

      if (!res.ok) {
        handlers.onError?.({ message: (await toError(res)).message });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        handlers.onError?.({ message: "No readable response body" });
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        // SSE messages are separated by a blank line
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          if (!block.trim()) continue;
          let eventName = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (!data.length) continue;

          let parsed;
          try {
            parsed = JSON.parse(data.join("\n"));
          } catch {
            continue;
          }
          switch (eventName) {
            case "trace":
              handlers.onTrace?.(parsed as TraceEventData);
              break;
            case "delta":
              handlers.onDelta?.(parsed.text ?? "");
              break;
            case "replace":
              handlers.onReplace?.(parsed);
              break;
            case "final":
              handlers.onFinal?.(parsed as FinalEventData);
              break;
            case "error":
              handlers.onError?.({ message: parsed.message ?? parsed.detail ?? "error", query_id: parsed.query_id });
              break;
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        handlers.onError?.({ message: (err as Error)?.message || "Network error" });
      }
    } finally {
      handlers.onClose?.();
    }
  };

  run();

  return { abort: () => controller.abort() };
}
