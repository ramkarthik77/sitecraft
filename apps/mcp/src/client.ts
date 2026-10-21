/** Thin client for the Sitecraft API, acting with the caller's token. */
export class SitecraftClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
      const extra = data && typeof data === "object" && "errors" in data ? `\n${(data as { errors: string[] }).errors.join("\n")}` : "";
      throw new ApiError(res.status, msg + extra);
    }
    return data as T;
  }

  get = <T>(p: string) => this.request<T>("GET", p);
  post = <T>(p: string, b: unknown = {}) => this.request<T>("POST", p, b);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const enc = encodeURIComponent;
