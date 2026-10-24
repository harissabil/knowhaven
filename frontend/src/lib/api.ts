import { useSession } from "@/store/session";

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

export function getAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  const token = useSession.getState().sessionToken;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : path.startsWith("/api")
      ? path
      : `/api${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(init.headers || {});
  const authHeaders = getAuthHeaders() as Record<string, string>;
  for (const [k, v] of Object.entries(authHeaders)) {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  }

  if (
    init.body &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let payload: ApiErrorPayload | undefined;
    let errorMsg = `Request failed with status ${response.status}`;
    try {
      payload = await response.json();
      if (typeof payload?.detail === "string") {
        errorMsg = payload.detail;
      } else if (Array.isArray(payload?.detail) && payload.detail[0]?.msg) {
        errorMsg = payload.detail.map((d) => d.msg).join(", ");
      } else if (payload?.message) {
        errorMsg = payload.message;
      }
    } catch {
      // not JSON
    }
    throw new ApiError(errorMsg, response.status, payload);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export interface TraceEventData {
  step: number;
  label: string;
  name: string;
  status: "running" | "done";
  ms?: number;
  summary?: string;
}

export interface CitationItem {
  id: string;
  type: string;
  title: string;
  container: string;
  url?: string | null;
  date?: string;
}

export interface ConflictItem {
  is_conflict: boolean;
  winner?: string;
  losers?: string[];
  reason?: string;
  topic?: string;
}

export interface AccessOffer {
  topic_id?: string;
  topic_name?: string;
  container_id?: string;
  container_name?: string;
  approver_name?: string;
  can_request?: boolean;
}

export interface FinalEventData {
  query_id: string;
  conversation_id: string;
  answer: string;
  decision_path: "answer" | "idk" | "refusal" | "smalltalk" | "error";
  citations: CitationItem[];
  conflicts: ConflictItem[];
  stale_doc_ids?: string[];
  access_offer?: AccessOffer | null;
  notes?: string[];
  action_draft_ids?: string[];
  data_as_of?: string | null;
  latency_ms?: number;
}

export interface StreamHandlers {
  onTrace?: (data: TraceEventData) => void;
  onDelta?: (token: string) => void;
  onReplace?: (data: { answer: string; reason?: string }) => void;
  onFinal?: (data: FinalEventData) => void;
  onError?: (err: { message: string; query_id?: string }) => void;
  onClose?: () => void;
}

export function apiStream(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
): { abort: () => void } {
  const controller = new AbortController();

  const run = async () => {
    try {
      const url = path.startsWith("http")
        ? path
        : path.startsWith("/api")
          ? path
          : `/api${path.startsWith("/") ? "" : "/"}${path}`;

      const headers = new Headers({
        "Content-Type": "application/json",
      });
      const auth = getAuthHeaders() as Record<string, string>;
      for (const [k, v] of Object.entries(auth)) {
        headers.set(k, v);
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "include",
      });

      if (!res.ok) {
        let msg = `SSE stream failed: ${res.status}`;
        try {
          const err = await res.json();
          msg = err.detail || err.message || msg;
        } catch {
          // ignore
        }
        handlers.onError?.({ message: msg });
        handlers.onClose?.();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        handlers.onError?.({ message: "No readable response body" });
        handlers.onClose?.();
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newline
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          if (!block.trim()) continue;
          let eventName = "message";
          let dataStr = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataStr += line.slice(5).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const parsed = JSON.parse(dataStr);
            switch (eventName) {
              case "trace":
                handlers.onTrace?.(parsed as TraceEventData);
                break;
              case "delta":
                handlers.onDelta?.(parsed.token ?? "");
                break;
              case "replace":
                handlers.onReplace?.(parsed);
                break;
              case "final":
                handlers.onFinal?.(parsed as FinalEventData);
                break;
              case "error":
                handlers.onError?.(parsed);
                break;
            }
          } catch {
            // raw string delta fallback
            if (eventName === "delta") {
              handlers.onDelta?.(dataStr);
            }
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

  return {
    abort: () => controller.abort(),
  };
}
