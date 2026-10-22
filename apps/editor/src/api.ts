import type { SiteDocument } from "@sitecraft/schema";

const TOKEN_KEY = "sitecraft.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, raw?: { contentType: string; data: Blob }): Promise<T> {
  const token = getToken();
  // The local app needs no token; a signed-in person sends theirs.
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (raw) headers["content-type"] = raw.contentType;
  else if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { method, headers, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const errs = Array.isArray(d.errors) ? ` ${(d.errors as string[]).join("; ")}` : "";
    throw new ApiError(res.status, String(d.error ?? `Request failed (${res.status})`) + errs, d);
  }
  return data as T;
}

export const enc = encodeURIComponent;

export interface Me {
  name: string;
  role: "admin" | "editor" | "agent";
  /** Running as the local app: no sign-in, single owner. */
  local?: boolean;
}

/** Download a file from the API (sends the token when there is one). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
export interface TokenInfo {
  id: string;
  name: string;
  role: "admin" | "editor" | "agent";
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  siteIds: string[] | null;
}

export const Tokens = {
  list: () => api<TokenInfo[]>("GET", "/tokens"),
  create: (t: { name: string; role: string; expiresInDays: number | null; sites?: string[] }) => api<TokenInfo & { token: string }>("POST", "/tokens", t),
  revoke: (id: string) => api("DELETE", `/tokens/${id}`),
  auditCsv: () => download("/audit.csv", "sitecraft-audit.csv"),
};

export interface SiteSummary {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  liveUrl: string | null;
  publishUrl: string;
  updatedAt?: string;
  brandId?: string | null;
}
export interface Branch {
  name: string;
  headVersionId: number;
  baseVersionId: number | null;
  hasChanges: boolean;
  createdBy: string;
  lastChangeBy: string;
  lastMessage: string;
  updatedAt: string;
}
export interface Version {
  id: number;
  message: string;
  actor: string;
  actorRole: string;
  createdAt: string;
}
export interface Diff {
  summary: string[];
  added: string[];
  removed: string[];
  changed: string[];
  themeChanged: boolean;
  brandIssues?: string[];
}
export interface Deployment {
  id: string;
  versionId: number;
  url: string;
  actor: string;
  createdAt: string;
  current: boolean;
}

export const Sites = {
  list: () => api<SiteSummary[]>("GET", "/sites"),
  create: (name: string, template: string, templateId?: string) => api<SiteSummary>("POST", "/sites", templateId ? { name, templateId } : { name, template }),
  setBrand: (id: string, brandId: string | null) => api<{ brandId: string | null; changed: boolean }>("PUT", `/sites/${id}/brand`, { brandId }),
  get: (id: string) => api<SiteSummary>("GET", `/sites/${id}`),
  update: (id: string, patch: { name?: string; domain?: string | null }) => api<SiteSummary>("PATCH", `/sites/${id}`, patch),
  remove: (id: string) => api("DELETE", `/sites/${id}`),
  branches: (id: string) => api<Branch[]>("GET", `/sites/${id}/branches`),
  createBranch: (id: string, name: string, from = "main") => api("POST", `/sites/${id}/branches`, { name, from }),
  deleteBranch: (id: string, b: string) => api("DELETE", `/sites/${id}/branches/${enc(b)}`),
  head: (id: string, b: string) => api<{ versionId: number; document: SiteDocument }>("GET", `/sites/${id}/branches/${enc(b)}`),
  save: (id: string, b: string, document: SiteDocument, baseVersion: number, message?: string) =>
    api<{ versionId: number }>("PUT", `/sites/${id}/branches/${enc(b)}/document`, { document, baseVersion, message }),
  versions: (id: string, b: string) => api<Version[]>("GET", `/sites/${id}/branches/${enc(b)}/versions`),
  restore: (id: string, b: string, versionId: number) => api<{ versionId: number }>("POST", `/sites/${id}/branches/${enc(b)}/restore`, { versionId }),
  diff: (id: string, b: string) => api<Diff>("GET", `/sites/${id}/branches/${enc(b)}/diff`),
  merge: (id: string, b: string, force = false) => api<{ versionId: number }>("POST", `/sites/${id}/branches/${enc(b)}/merge`, { force }),
  previewUrl: (id: string, b: string) => api<{ url: string }>("GET", `/sites/${id}/branches/${enc(b)}/preview-url`),
  publish: (id: string) => api<{ url: string; versionId: number }>("POST", `/sites/${id}/publish`, {}),
  deployments: (id: string) => api<Deployment[]>("GET", `/sites/${id}/deployments`),
  rollback: (id: string, dep: string) => api("POST", `/sites/${id}/deployments/${dep}/rollback`, {}),
  eventsTicket: (id: string) => api<{ ticket: string }>("POST", `/sites/${id}/events/ticket`, {}),
  formsCsv: (id: string, slug: string) => download(`/sites/${id}/forms.csv`, `${slug}-forms.csv`),
  deleteForms: (id: string, q: { form?: string; before?: string; containing?: string } = {}) =>
    api<{ deleted: number }>("DELETE", `/sites/${id}/forms?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  forms: (id: string) => api<{ id: number; form: string; data: Record<string, string>; created_at: string }[]>("GET", `/sites/${id}/forms`),
  exportZip: (id: string, slug: string, url?: string) => download(`/sites/${id}/export${url ? `?url=${enc(url)}` : ""}`, `${slug}.zip`),
  upload: (id: string, file: File) =>
    api<{ url: string }>("POST", `/sites/${id}/assets?filename=${enc(file.name)}`, undefined, { contentType: file.type, data: file }),
};

export interface SavedTemplate {
  id: string;
  name: string;
  description: string;
  brandId: string | null;
  brandName: string | null;
  createdBy: string;
  updatedAt: string;
  pages?: number;
}

export const Templates = {
  list: () => api<SavedTemplate[]>("GET", "/site-templates"),
  get: (id: string) => api<SavedTemplate & { document: SiteDocument }>("GET", `/site-templates/${id}`),
  create: (t: { siteId: string; name: string; description?: string; includeItems?: boolean }) => api<SavedTemplate>("POST", "/site-templates", t),
  update: (id: string, t: { name?: string; description?: string; siteId?: string; includeItems?: boolean }) => api<SavedTemplate>("PATCH", `/site-templates/${id}`, t),
  remove: (id: string) => api("DELETE", `/site-templates/${id}`),
};

export interface Brand {
  id: string;
  name: string;
  version: number;
  locked: boolean;
  theme: SiteDocument["theme"];
  logo: string | null;
  guidelines: string;
  components: { id: string; name: string }[];
  sites?: number;
  createdBy: string;
  updatedAt: string;
}

export const Brands = {
  list: () => api<Brand[]>("GET", "/brands"),
  get: (id: string) => api<Brand & { siteList: { id: string; name: string; slug: string }[] }>("GET", `/brands/${id}`),
  create: (b: { name: string; fromSite: string; components?: string[]; guidelines?: string; logo?: string; locked?: boolean }) => api<Brand>("POST", "/brands", b),
  update: (id: string, b: Partial<{ name: string; guidelines: string; logo: string | null; locked: boolean; theme: SiteDocument["theme"]; fromSite: string; components: string[] }>) =>
    api<Brand & { updatedSites: number }>("PATCH", `/brands/${id}`, b),
  remove: (id: string) => api("DELETE", `/brands/${id}`),
};

export interface Schedule {
  id: string;
  siteId: string;
  branch: string;
  runAt: string;
  note: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result: string | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export const Schedules = {
  list: (siteId: string) => api<Schedule[]>("GET", `/sites/${siteId}/schedules`),
  create: (siteId: string, s: { branch: string; runAt: string; note?: string }) => api<Schedule>("POST", `/sites/${siteId}/schedules`, s),
  cancel: (siteId: string, id: string) => api("DELETE", `/sites/${siteId}/schedules/${id}`),
};
