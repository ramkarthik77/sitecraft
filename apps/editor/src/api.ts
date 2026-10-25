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
  /** Review disciplines this person signs off for. */
  disciplines?: string[];
  /** For Claude: who it works for. */
  onBehalfOf?: string | null;
  agentCanPublish?: boolean;
  agentCanEditMain?: boolean;
  /** Set when the token only opens some sites. */
  limitedToSites?: number | null;
  orgName?: string;
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
  onBehalfOf?: string | null;
  disciplines?: string[];
}

export const Tokens = {
  list: () => api<TokenInfo[]>("GET", "/tokens"),
  create: (t: { name: string; role: string; expiresInDays: number | null; sites?: string[]; onBehalfOf?: string; disciplines?: string[] }) => api<TokenInfo & { token: string }>("POST", "/tokens", t),
  update: (id: string, patch: { disciplines?: string[]; onBehalfOf?: string | null }) => api("PATCH", `/tokens/${id}`, patch),
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
  requiredApprovals?: number;
  therapyArea?: string | null;
  market?: string | null;
  audience?: string | null;
  jobCode?: string | null;
  reviewDisciplines?: string[];
  requireJobCodes?: boolean;
  brandName?: string | null;
  pageCount?: number;
  openReviews?: number;
  openBranches?: number;
  claudeBranches?: number;
  nextRelease?: string | null;
  folderId?: string | null;
}

export interface SiteProfile {
  therapyArea: string | null;
  market: string | null;
  audience: string | null;
  jobCode: string | null;
  reviewDisciplines: string[];
  requireJobCodes: boolean;
}
export interface Blocker {
  kind: "job-code" | "asset-expired" | "asset-unapproved" | "asset-market";
  message: string;
  pageId?: string;
  assetId?: string;
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
export interface VersionChanges {
  pages: { id: string; path: string; title: string; added: number; changed: number; removed: number; status?: "added" | "removed" }[];
  pageIds: string[];
  added: number;
  changed: number;
  removed: number;
  theme: boolean;
  components: boolean;
  content: string[];
  settings: boolean;
}
export type VersionKind = "edit" | "merge" | "restore" | "create" | "brand";
export interface Version {
  id: number;
  parentId: number | null;
  message: string;
  actor: string;
  actorRole: string;
  createdAt: string;
  label: string | null;
  kind: VersionKind;
  changes: VersionChanges | null;
  published: boolean;
  live: boolean;
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
  create: (name: string, template: string, templateId?: string, folderId?: string | null) =>
    api<SiteSummary>("POST", "/sites", { name, ...(templateId ? { templateId } : { template }), ...(folderId ? { folderId } : {}) }),
  setFolder: (id: string, folderId: string | null) => api<{ folderId: string | null }>("PUT", `/sites/${id}/folder`, { folderId }),
  setRequiredApprovals: (id: string, required: number) => api<{ required: number }>("PUT", `/sites/${id}/approvals-required`, { required }),
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
  versions: (id: string, b: string, q: { before?: number; page?: string; only?: "named" | "published"; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return api<Version[]>("GET", `/sites/${id}/branches/${enc(b)}/versions${p.size ? `?${p}` : ""}`);
  },
  restore: (id: string, b: string, versionId: number, part: { pageId?: string; nodeId?: string } = {}) =>
    api<{ versionId: number }>("POST", `/sites/${id}/branches/${enc(b)}/restore`, { versionId, ...part }),
  diff: (id: string, b: string) => api<Diff>("GET", `/sites/${id}/branches/${enc(b)}/diff`),
  merge: (id: string, b: string, force = false, override = false) => api<{ versionId: number }>("POST", `/sites/${id}/branches/${enc(b)}/merge`, { force, override }),
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
  profile: (id: string, p: Partial<Pick<SiteProfile, "therapyArea" | "market" | "audience" | "jobCode">>) => api<SiteProfile>("PUT", `/sites/${id}/profile`, p),
  policy: (id: string, p: { reviewDisciplines?: string[]; requireJobCodes?: boolean; requiredApprovals?: number }) => api<SiteProfile & { requiredApprovals: number }>("PUT", `/sites/${id}/policy`, p),
  readiness: (id: string) => api<{ ready: boolean; blockers: Blocker[] }>("GET", `/sites/${id}/readiness`),
  uploads: (id: string) => api<{ id: string; fileName: string; url: string; createdAt: string }[]>("GET", `/sites/${id}/assets`),
  upload: (id: string, file: File) =>
    api<{ url: string }>("POST", `/sites/${id}/assets?filename=${enc(file.name)}`, undefined, { contentType: file.type, data: file }),
};

export interface SavedTemplate {
  id: string;
  name: string;
  description: string;
  brandId: string | null;
  brandName: string | null;
  sourceSiteId?: string | null;
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

export interface LibraryAsset {
  id: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  title: string;
  alt: string;
  credit: string;
  tags: string[];
  focalX: number;
  focalY: number;
  expiresAt: string | null;
  expired: boolean;
  status: AssetStatus;
  jobCode: string | null;
  markets: string[];
  brandId: string | null;
  folderId: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetStatus = "draft" | "in_review" | "approved" | "withdrawn";
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = { draft: "Draft", in_review: "In review", approved: "Approved", withdrawn: "Withdrawn" };

export const Library = {
  list: (q: { q?: string; tag?: string; status?: string; market?: string; brand?: string; expiring?: string; folder?: string } = {}) =>
    api<LibraryAsset[]>("GET", `/assets?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`),
  tags: () => api<{ tag: string; count: number }[]>("GET", "/assets/tags"),
  upload: (file: File, folderId?: string | null) =>
    api<LibraryAsset>("POST", `/assets?filename=${enc(file.name)}${folderId ? `&folderId=${enc(folderId)}` : ""}`, undefined, { contentType: file.type, data: file }),
  update: (
    id: string,
    patch: Partial<Pick<LibraryAsset, "title" | "alt" | "credit" | "tags" | "focalX" | "focalY" | "status" | "markets">> & { expiresAt?: string | null; jobCode?: string; brandId?: string | null; folderId?: string | null },
  ) => api<LibraryAsset>("PATCH", `/assets/${id}`, patch),
  replace: (id: string, file: File) => api<LibraryAsset>("PUT", `/assets/${id}/file`, undefined, { contentType: file.type, data: file }),
  usage: (id: string) => api<{ siteId: string; siteName: string; slug: string; where: string[] }[]>("GET", `/assets/${id}/usage`),
  remove: (id: string, force = false) => api("DELETE", `/assets/${id}${force ? "?force=1" : ""}`),
};

export interface Comment {
  id: string;
  branch: string;
  targetKind: "site" | "node" | "item";
  targetId: string | null;
  targetLabel: string;
  parentId: string | null;
  body: string;
  author: string;
  authorRole: string;
  mentions: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export const Comments = {
  list: (siteId: string, branch: string) => api<Comment[]>("GET", `/sites/${siteId}/comments?branch=${enc(branch)}`),
  add: (siteId: string, c: { branch: string; body: string; targetKind?: string; targetId?: string; targetLabel?: string; parentId?: string }) => api<Comment>("POST", `/sites/${siteId}/comments`, c),
  resolve: (siteId: string, id: string, resolved: boolean) => api<Comment>("PATCH", `/sites/${siteId}/comments/${id}`, { resolved }),
  remove: (siteId: string, id: string) => api("DELETE", `/sites/${siteId}/comments/${id}`),
};

export interface ApprovalInfo {
  required: number;
  versionId: number;
  approvals: { approver: string; role: string; note: string; at: string; discipline: string; signed: boolean; meaning: string | null }[];
  authors: string[];
  byClaude: boolean;
  disciplines: string[];
  missing: string[];
  changesRequested: boolean;
  met: boolean;
  approvedByMe: boolean;
  canApprove: boolean;
  reason: string;
  /** Disciplines this person may sign off for here. */
  myDisciplines: string[];
  /** MLR sign-off is an electronic signature. */
  needsSignature: boolean;
  /** Signing asks for the sign-in token again (not on the local app). */
  signInWithToken: boolean;
}

export interface Signature {
  name: string;
  token?: string;
}

export const Approvals = {
  get: (siteId: string, branch: string) => api<ApprovalInfo>("GET", `/sites/${siteId}/branches/${enc(branch)}/approvals`),
  approve: (siteId: string, branch: string, opts: string | { note?: string; discipline?: string; signature?: Signature } = {}) =>
    api("POST", `/sites/${siteId}/branches/${enc(branch)}/approvals`, typeof opts === "string" ? { note: opts } : opts),
  withdraw: (siteId: string, branch: string) => api("DELETE", `/sites/${siteId}/branches/${enc(branch)}/approvals`),
};

export interface ActivityItem {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  detail: Record<string, unknown> & { pages?: VersionChanges["pages"]; message?: string; branch?: string; versionId?: number; label?: string | null };
}
export interface SiteAccess {
  id?: string;
  name: string;
  role: "admin" | "editor" | "agent";
  scope: string;
  createdAt: string | null;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
export interface CalendarEvent {
  id: string;
  kind: "release" | "published" | "rollback";
  siteId: string;
  siteName: string;
  at: string;
  branch: string;
  note: string;
  status: string;
  by: string;
  result?: string | null;
  versionId?: number;
}

export const History = {
  version: (siteId: string, v: number) =>
    api<{ id: number; branch: string; message: string; actor: string; createdAt: string; label: string | null; kind: VersionKind; document: SiteDocument }>("GET", `/sites/${siteId}/versions/${v}`),
  compare: (siteId: string, v: number, withVersion: number | "current" = "current") =>
    api<{ added: string[]; removed: string[]; changed: string[]; pagesAdded: string[]; pagesRemoved: string[]; pagesChanged: string[]; themeChanged: boolean; content: string[]; summary: string[] }>(
      "GET",
      `/sites/${siteId}/versions/${v}/compare?with=${withVersion}`,
    ),
  name: (siteId: string, v: number, label: string | null) => api("PATCH", `/sites/${siteId}/versions/${v}`, { label }),
  liveAt: (siteId: string, at: string) =>
    api<{ live: { deploymentId: string; versionId: number; since: string; by: string; reason: string } | null }>("GET", `/sites/${siteId}/live-at?at=${enc(at)}`),
  activity: (siteId: string, q: { before?: string; actor?: string; kind?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return api<{ items: ActivityItem[]; people: { name: string; count: number }[] }>("GET", `/sites/${siteId}/activity${p.size ? `?${p}` : ""}`);
  },
  activityCsv: (siteId: string, slug: string) => download(`/sites/${siteId}/activity.csv`, `${slug}-activity.csv`),
  access: (siteId: string) => api<SiteAccess[]>("GET", `/sites/${siteId}/access`),
  calendar: (from: string, to: string) => api<CalendarEvent[]>("GET", `/calendar?from=${enc(from)}&to=${enc(to)}`),
};

// ── Regulated work: reviews, my work, notifications, audit ─────────────────

export type ReviewStatus = "open" | "approved" | "changes_requested" | "merged" | "withdrawn";
export interface Review {
  id: string;
  siteId: string;
  siteName: string;
  brand: string | null;
  therapyArea: string | null;
  market: string | null;
  audience: string | null;
  branch: string;
  title: string;
  note: string;
  jobCode: string | null;
  dueAt: string | null;
  status: ReviewStatus;
  requestedBy: string;
  requestedByRole: string;
  createdAt: string;
  updatedAt: string;
  byClaude: boolean;
  approvals: { have: number; required: number; disciplines: string[]; missing: string[]; list: ApprovalInfo["approvals"] } | null;
  authors: string[];
  canReview: boolean;
  approvedByMe: boolean;
}
export interface ReviewEvent {
  id: number;
  actor: string;
  role: string;
  action: "request" | "approve" | "request_changes" | "resubmit" | "withdraw" | "merge";
  discipline: string | null;
  reason: string;
  versionId: number | null;
  at: string;
}
export interface ReviewDetail extends Review {
  changes: { added: number; removed: number; changed: number; pages: { path: string; title: string }[]; summary: string[] } | null;
  events: ReviewEvent[];
}

export const Reviews = {
  list: (q: { status?: "open" | "closed" | "all"; siteId?: string; mine?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.status) p.set("status", q.status);
    if (q.siteId) p.set("siteId", q.siteId);
    if (q.mine) p.set("mine", "1");
    return api<Review[]>("GET", `/reviews${p.size ? `?${p}` : ""}`);
  },
  get: (id: string) => api<ReviewDetail>("GET", `/reviews/${id}`),
  request: (siteId: string, branch: string, r: { title: string; note?: string; jobCode?: string; dueAt?: string }) => api<Review>("POST", `/sites/${siteId}/branches/${enc(branch)}/reviews`, r),
  changes: (id: string, reason: string, discipline?: string) => api<Review>("POST", `/reviews/${id}/changes`, { reason, discipline }),
  resubmit: (id: string, note?: string) => api<Review>("POST", `/reviews/${id}/resubmit`, { note }),
  withdraw: (id: string) => api<Review>("POST", `/reviews/${id}/withdraw`, {}),
};

export type WorkKind = "review" | "changes" | "claude" | "release" | "asset";
export interface WorkItem {
  id: string;
  kind: WorkKind;
  title: string;
  siteId?: string;
  siteName?: string;
  detail: string;
  due: string | null;
  link: string;
  reviewId?: string;
  branch?: string;
}
export interface WorkCounts {
  review: number;
  changes: number;
  claude: number;
  release: number;
  asset: number;
  reviewDueToday: number;
  assetWithin7: number;
}
export const Work = { get: () => api<{ items: WorkItem[]; counts: WorkCounts }>("GET", "/work") };

export interface Notification {
  id: string;
  siteId: string | null;
  siteName: string | null;
  actor: string;
  role: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
  unread: boolean;
}
export const Notifications = {
  list: () => api<{ items: Notification[]; unread: number }>("GET", "/notifications"),
  seen: () => api("POST", "/notifications/seen", {}),
};

export interface AuditEntry {
  seq: number;
  id: string;
  siteId: string | null;
  siteName: string | null;
  actor: string;
  role: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
  hash: string;
}
export interface AuditCheck {
  ok: boolean;
  entries: number;
  brokenAt: number | null;
  head: { seq: number; hash: string; at: string } | null;
  checkedAt: string;
}
export const Audit = {
  list: (q: { before?: number; actor?: string; action?: string; siteId?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return api<{ items: AuditEntry[]; people: { name: string; count: number }[] }>("GET", `/audit${p.size ? `?${p}` : ""}`);
  },
  verify: () => api<AuditCheck>("GET", "/audit/verify"),
  csv: () => download("/audit.csv", "sitecraft-audit.csv"),
};

export interface SharedComponent {
  id: string;
  name: string;
  type: string;
  brandId: string;
  brandName: string;
  brandVersion: number;
  locked: boolean;
  sites: number;
  updatedAt: string | null;
}
export const Components = { list: () => api<SharedComponent[]>("GET", "/components") };

export const DISCIPLINES = ["medical", "legal", "regulatory"] as const;
export const AUDIENCES = [
  ["hcp", "HCP"],
  ["patient", "Patient"],
  ["caregiver", "Caregiver"],
  ["consumer", "Consumer"],
  ["corporate", "Corporate"],
] as const;
export const audienceLabel = (a: string | null | undefined) => AUDIENCES.find(([k]) => k === a)?.[1] ?? "";
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type FolderKind = "site" | "asset";
export interface Folder {
  id: string;
  kind: FolderKind;
  name: string;
  parentId: string | null;
  count: number;
  createdBy: string;
}
export const Folders = {
  list: (kind: FolderKind) => api<Folder[]>("GET", `/folders?kind=${kind}`),
  create: (kind: FolderKind, name: string, parentId?: string | null) => api<Folder>("POST", "/folders", { kind, name, parentId: parentId ?? null }),
  update: (id: string, patch: { name?: string; parentId?: string | null }) => api<Folder>("PATCH", `/folders/${id}`, patch),
  remove: (id: string) => api("DELETE", `/folders/${id}`),
};

export interface ImportResult {
  site: SiteSummary;
  pages: { path: string; title: string; source: string; sections: number }[];
  theme: { colors: Record<string, string>; fonts: { heading?: string; body?: string } };
  warnings: string[];
}
export const Imports = {
  run: (r: { url: string; name?: string; maxPages?: number; folderId?: string | null }) => api<ImportResult>("POST", "/imports", { ...r, folderId: r.folderId ?? undefined }),
};
