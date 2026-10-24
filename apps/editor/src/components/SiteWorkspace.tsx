import { useCallback, useEffect, useMemo, useState } from "react";
import { findCollection, languageName, type SiteDocument } from "@sitecraft/schema";
import {
  ASSET_STATUS_LABEL,
  AUDIENCES,
  audienceLabel,
  Brands,
  cap,
  DISCIPLINES,
  History,
  Library,
  Reviews,
  Sites,
  type ActivityItem,
  type Blocker,
  type Brand,
  type Branch,
  type Deployment,
  type LibraryAsset,
  type Me,
  type Review,
  type SiteSummary,
} from "../api";
import { DocThumb } from "../App";
import { ago, initials } from "../format";
import { navigate } from "../router";
import { refreshShared, useShared } from "../store";
import { useToast } from "../Toasts";
import { AccessList, ActivityLog, describe } from "./Activity";
import { Icon } from "./Icon";
import { orderedPages, templatePages } from "./PageSwitcher";
import { RequestReviewDialog } from "./Reviews";
import { TimeMachine } from "./TimeMachine";
import { ConnectClaude, editorHref, go, PageHead, Pill, siteUrl } from "./Shell";
import { portfolioPath, siteStatus } from "./Directory";
import { dueLabel } from "./Work";

/** Inside one site: overview, branches, assets, activity and access, settings, history. */

export function useSite(siteId: string) {
  const { sites } = useShared();
  const [site, setSite] = useState<SiteSummary | null>(null);
  const toast = useToast();
  const listed = sites?.find((s) => s.id === siteId || s.slug === siteId) ?? null;
  const reload = useCallback(
    () =>
      Sites.get(siteId)
        .then(setSite)
        .catch((e) => (toast({ text: e.message, tone: "error" }), navigate("/sites"))),
    [siteId, toast],
  );
  useEffect(() => void reload(), [reload]);
  // The list has counts (reviews, branches); the site itself is freshest.
  return { site: site ? { ...listed, ...site } : listed, reload };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

// ── Overview ────────────────────────────────────────────────────────────

export function SiteOverviewPage({ siteId, me }: { siteId: string; me: Me }) {
  const { site } = useSite(siteId);
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [deploys, setDeploys] = useState<Deployment[]>([]);
  const [ready, setReady] = useState<{ ready: boolean; blockers: Blocker[] } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [recent, setRecent] = useState<ActivityItem[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [connect, setConnect] = useState(false);
  const person = me.role !== "agent";
  useEffect(() => {
    Sites.head(siteId, "main").then((h) => setDoc(h.document), () => {});
    Sites.deployments(siteId).then(setDeploys, () => {});
    Sites.readiness(siteId).then(setReady, () => {});
    Reviews.list({ siteId }).then(setReviews, () => {});
    if (person) History.activity(siteId).then((r) => setRecent(r.items.slice(0, 6)), () => setRecent([]));
  }, [siteId, person]);

  const pages = doc ? [...orderedPages(doc), ...templatePages(doc).map((t) => ({ page: t.page, depth: 0, label: t.page.title }))] : [];
  const lastLive = deploys.find((d) => d.current) ?? deploys[0];
  const pageUrl = (path: string) => (site?.liveUrl ? `${site.liveUrl.replace(/\/$/, "")}${path === "/" ? "/" : path}` : null);
  const nextDue = reviews.filter((r) => r.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0];
  const missingCodes = new Set((ready?.blockers ?? []).filter((b) => b.kind === "job-code").map((b) => b.pageId));
  const path = site ? portfolioPath(site) : [];
  const st = site ? siteStatus(site) : null;

  return (
    <main className="page">
      <PageHead
        eyebrow="Site workspace"
        title={site?.name ?? " "}
        sub={
          <>
            {path.length ? path.join(" › ") : person ? <a href={siteUrl(siteId, "settings")} onClick={go(siteUrl(siteId, "settings"))}>File this site: add its therapy area, market and audience</a> : "Not filed yet"}
            {site?.domain ? ` · ${site.domain}` : ""}
          </>
        }
        actions={
          <>
            <a className="btn" href={editorHref(siteId)} onClick={go(editorHref(siteId))}>
              <Icon name="pages" size={14} /> Open editor
            </a>
            <button className="btn agent-outline" onClick={() => setConnect(true)}>
              <Icon name="sparkle" size={14} /> Ask Claude to draft
            </button>
          </>
        }
      />

      <section className="live-card">
        <div className="live-thumb">
          <DocThumb doc={doc} />
        </div>
        <div className="grow live-body">
          <span className="eyebrow">
            <Icon name="globe" size={12} /> Live site {st && <Pill tone={st.tone}>{st.label}</Pill>}
            {ready && (ready.ready ? <Pill tone="ok">Ready to publish</Pill> : <Pill tone="danger">{ready.blockers.length} blocking publish</Pill>)}
          </span>
          {site?.liveUrl ? (
            <p className="live-url">
              <a href={site.liveUrl} target="_blank" rel="noreferrer">
                {site.liveUrl.replace(/^https?:\/\//, "")} <Icon name="external" size={12} />
              </a>
              <button
                className="btn ghost sm"
                onClick={() =>
                  void navigator.clipboard?.writeText(site.liveUrl!).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                <Icon name="copy" size={12} /> {copied ? "Copied" : "Copy link"}
              </button>
            </p>
          ) : (
            <p className="live-url muted">Not published yet. Open the editor and publish, or schedule it in Releases.</p>
          )}
          <span className="muted small">
            {lastLive ? `Published ${ago(lastLive.createdAt)} by ${lastLive.actor}` : "Never published"}. Changes go through branches, sign-off and releases; every version is kept in History.
          </span>
          {ready && !ready.ready && (
            <ul className="blockers">
              {ready.blockers.slice(0, 4).map((b, i) => (
                <li key={i}>
                  <Icon name="alert" size={12} /> {b.message}
                </li>
              ))}
              {ready.blockers.length > 4 && <li className="muted">and {ready.blockers.length - 4} more</li>}
            </ul>
          )}
        </div>
        <span className="live-branch mono">
          <Icon name="branch" size={13} /> main
        </span>
      </section>

      <div className="stats">
        <a className="stat t-human" href={editorHref(siteId, { tab: "pages" })} onClick={go(editorHref(siteId, { tab: "pages" }))}>
          <span className="stat-top">
            Pages
            <span className="stat-ic" aria-hidden="true">
              <Icon name="pages" size={14} />
            </span>
          </span>
          <strong className="stat-num">{doc ? pages.length : "–"}</strong>
          <span className="stat-sub">{doc ? `${pages.filter((p) => p.page.unpublished).length} hidden · ${missingCodes.size} without a job code` : " "}</span>
        </a>
        <a className="stat t-agent" href={siteUrl(siteId, "branches")} onClick={go(siteUrl(siteId, "branches"))}>
          <span className="stat-top">
            Open branches
            <span className="stat-ic" aria-hidden="true">
              <Icon name="branch" size={14} />
            </span>
          </span>
          <strong className="stat-num">{site?.openBranches ?? "–"}</strong>
          <span className="stat-sub">{site?.claudeBranches ? `${site.claudeBranches} from Claude, waiting for a person` : "None from Claude"}</span>
        </a>
        <a className="stat t-warn" href={siteUrl(siteId, "reviews")} onClick={go(siteUrl(siteId, "reviews"))}>
          <span className="stat-top">
            Pending MLR
            <span className="stat-ic" aria-hidden="true">
              <Icon name="shield" size={14} />
            </span>
          </span>
          <strong className="stat-num">{reviews.length}</strong>
          <span className="stat-sub">{nextDue ? `Next due ${dueLabel(nextDue.dueAt)}` : site?.reviewDisciplines?.length ? `${site.reviewDisciplines.join(", ")} sign-off` : "No MLR sign-off set"}</span>
        </a>
        <a className="stat t-cms" href={siteUrl(siteId, "settings")} onClick={go(siteUrl(siteId, "settings"))}>
          <span className="stat-top">
            Job code
            <span className="stat-ic" aria-hidden="true">
              <Icon name="audit" size={14} />
            </span>
          </span>
          <strong className="stat-num stat-code">{site?.jobCode ?? "Not set"}</strong>
          <span className="stat-sub">{site?.requireJobCodes ? "Every page needs its own" : "Page job codes optional"}</span>
        </a>
      </div>

      {!!site?.claudeBranches && (
        <a className="claude-card wide" href={siteUrl(siteId, "branches")} onClick={go(siteUrl(siteId, "branches"))}>
          <span className="connect-mark" aria-hidden="true">
            <Icon name="sparkle" size={15} />
          </span>
          <span className="grow">
            <strong>Claude has {site.claudeBranches === 1 ? "a branch" : `${site.claudeBranches} branches`} ready for your review</strong>
            <span>Isolated changes; nothing reaches the live site until a person reviews and merges.</span>
          </span>
          <span className="btn agent-outline sm">Review Claude's branch</span>
        </a>
      )}

      <div className="cols">
        <div className="stack">
          <section className="card" aria-labelledby="ov-pages">
            <div className="card-head">
              <div className="grow">
                <h2 id="ov-pages">
                  Pages <span className="muted">{pages.length}</span>
                </h2>
                <span className="muted small">Content and compliance checkpoints</span>
              </div>
              {person && (
                <a className="btn sm" href={editorHref(siteId, { tab: "pages", new: "page" })} onClick={go(editorHref(siteId, { tab: "pages", new: "page" }))}>
                  <Icon name="plus" size={12} /> New page
                </a>
              )}
            </div>
            <div className="page-table" role="table" aria-label="Pages">
              {pages.map(({ page: p, depth }) => {
                const col = p.collectionId && doc ? findCollection(doc, p.collectionId) : undefined;
                const live = !col && !p.unpublished ? pageUrl(p.path) : null;
                const edit = editorHref(siteId, { page: p.id });
                return (
                  <div key={p.id} className="page-row" role="row" style={{ paddingLeft: 14 + depth * 22 }}>
                    <Icon name={col ? "database" : "pages"} size={14} style={col ? { color: "var(--cms)" } : undefined} />
                    <a className="grow page-name" href={edit} onClick={go(edit)} role="cell">
                      <strong>{p.path === "/" ? "Home" : p.title}</strong>
                      <span className="mono muted">{p.path}</span>
                    </a>
                    <span role="cell" className="page-flags">
                      {p.jobCode ? <span className="type-chip mono">{p.jobCode}</span> : site?.requireJobCodes && !p.unpublished ? <Pill tone="danger">No job code</Pill> : null}
                      {col ? (
                        <span className="type-chip cms-chip">
                          Page for each {col.name} item · {col.items.filter((i) => !i.draft).length} live
                        </span>
                      ) : p.unpublished ? (
                        <span className="type-chip hidden-chip">Hidden</span>
                      ) : null}
                    </span>
                    {live && (
                      <a className="btn ghost icon sm" href={live} target="_blank" rel="noreferrer" aria-label={`Open ${p.title} on the live site`} title="Open on the live site">
                        <Icon name="external" size={13} />
                      </a>
                    )}
                    <a className="btn sm" href={edit} onClick={go(edit)}>
                      Edit
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
          {(doc?.collections?.length ?? 0) > 0 && (
            <section className="card" aria-labelledby="ov-cms">
              <div className="card-head">
                <h2 id="ov-cms">CMS content</h2>
              </div>
              <div className="card-body cms-cards">
                {doc!.collections!.map((c) => {
                  const href = editorHref(siteId, { tab: "cms", cms: c.id });
                  const drafts = c.items.filter((i) => i.draft).length;
                  return (
                    <a key={c.id} className="cms-card" href={href} onClick={go(href)}>
                      <Icon name="database" size={15} />
                      <strong>{c.name}</strong>
                      <span className="muted small">
                        {c.items.length} {c.items.length === 1 ? "item" : "items"}
                        {drafts ? ` · ${drafts} draft` : ""}
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <div className="stack">
          {person && (
            <section className="card" aria-labelledby="ov-recent">
              <div className="card-head">
                <div className="grow">
                  <h2 id="ov-recent">Recent activity</h2>
                  <span className="muted small">People and Claude, from the audit trail</span>
                </div>
                <a className="small" href={siteUrl(siteId, "activity")} onClick={go(siteUrl(siteId, "activity"))}>
                  View activity <Icon name="arrow" size={12} />
                </a>
              </div>
              <div className="card-body">
                {recent === null && <div className="tm-loading small" />}
                {recent?.length === 0 && <div className="empty">Nothing yet.</div>}
                <ul className="mini-act">
                  {recent?.map((i) => {
                    const agent = i.role === "agent";
                    return (
                      <li key={i.id}>
                        <span className={`tm-avatar ${agent ? "agent" : ""}`} aria-hidden="true">
                          {agent ? "C" : initials(i.actor)}
                        </span>
                        <span className="grow">
                          <span>
                            <strong>{agent ? "Claude" : i.actor}</strong> {describe(i).text}
                          </span>
                          <span className="muted small">{ago(i.at)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
          <section className="card ov-facts" aria-label="About this site">
            <div className="card-body">
              <dl>
                <Fact label="Brand">{doc?.brand ? `${doc.brand.name}${doc.brand.locked ? " (locked)" : ""}` : (site?.brandName ?? "None")}</Fact>
                <Fact label="Languages">{doc ? [doc.settings.lang, ...(doc.settings.locales ?? [])].map(languageName).join(", ") : "…"}</Fact>
                <Fact label="Sign-off to merge">{site?.reviewDisciplines?.length ? site.reviewDisciplines.map(cap).join(", ") : site?.requiredApprovals ? `${site.requiredApprovals} approvals` : "None required"}</Fact>
                <Fact label="Address">
                  <span className="mono">{site?.domain ?? site?.slug ?? "…"}</span>
                </Fact>
              </dl>
            </div>
          </section>
        </div>
      </div>
      {connect && <ConnectClaude me={me} onClose={() => setConnect(false)} />}
    </main>
  );
}

// ── Branches ────────────────────────────────────────────────────────────

export function SiteBranches({ siteId, me }: { siteId: string; me: Me }) {
  const { site } = useSite(siteId);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState("");
  const toast = useToast();
  const load = useCallback(() => {
    Sites.branches(siteId).then(setBranches, () => setBranches([]));
    Reviews.list({ siteId }).then(setReviews, () => {});
  }, [siteId]);
  useEffect(load, [load]);
  const person = me.role !== "agent";
  const list = (branches ?? []).filter((b) => b.name !== "main").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const isClaude = (b: Branch) => /claude|agent/i.test(b.lastChangeBy) || b.name.startsWith("agent/");
  return (
    <main className="page">
      <PageHead
        eyebrow="Collaboration"
        title="Branches"
        sub="Every change is made on a branch, by a person or by Claude, reviewed, then merged into main. Main is what you publish."
        actions={
          person && (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await Sites.createBranch(siteId, name.trim());
                  navigate(editorHref(siteId, { branch: name.trim() }));
                } catch (err) {
                  toast({ text: (err as Error).message, tone: "error" });
                }
              }}
            >
              <input className="input" aria-label="New branch name" placeholder="e.g. dosing-update" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9._/-]/g, "-"))} />
              <button className="btn primary" disabled={!name.trim()}>
                <Icon name="plus" size={14} /> New branch
              </button>
            </form>
          )
        }
      />
      <section className="card">
        <div className="card-body">
          {branches === null && <div className="tm-loading small" />}
          {branches && list.length === 0 && <div className="empty">No branches yet. Start one here, or ask Claude for a change and it will make its own.</div>}
          <ul className="wq">
            {list.map((b) => {
              const r = reviews.find((x) => x.branch === b.name);
              const claude = isClaude(b);
              return (
                <li key={b.name} className="wq-row">
                  <span className={`wq-ic t-${claude ? "agent" : "human"}`} aria-hidden="true">
                    <Icon name={claude ? "sparkle" : "branch"} size={15} />
                  </span>
                  <a className="grow wq-main" href={editorHref(siteId, { branch: b.name })} onClick={go(editorHref(siteId, { branch: b.name }))}>
                    <strong>
                      <span className="mono">{b.name}</span> {claude && <Pill tone="agent">Claude</Pill>}
                    </strong>
                    <span className="muted small">
                      {b.hasChanges ? `${claude ? "Claude" : b.lastChangeBy}: ${b.lastMessage || "changes"}` : "No changes yet"} · {ago(b.updatedAt)}
                    </span>
                  </a>
                  <span className="wq-side">{r ? <Pill tone={r.status === "changes_requested" ? "danger" : r.status === "approved" ? "ok" : "human"}>{r.status === "changes_requested" ? "Changes requested" : r.status === "approved" ? "Signed off" : "In review"}</Pill> : b.hasChanges ? <Pill tone="muted">Not sent for review</Pill> : null}</span>
                  {r ? (
                    <a className="btn sm" href={`/reviews/${r.id}`} onClick={go(`/reviews/${r.id}`)}>
                      Open review
                    </a>
                  ) : (
                    b.hasChanges && (
                      <button className="btn sm" onClick={() => setAsking(b.name)}>
                        <Icon name="shield" size={13} /> Request review
                      </button>
                    )
                  )}
                  {b.hasChanges && (
                    <a className={`btn sm ${claude ? "agent-outline" : ""}`} href={editorHref(siteId, { branch: b.name, review: "1" })} onClick={go(editorHref(siteId, { branch: b.name, review: "1" }))}>
                      Review changes
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      {asking && <RequestReviewDialog siteId={siteId} branch={asking} jobCode={site?.jobCode} onClose={() => setAsking(null)} onDone={() => (setAsking(null), load())} />}
    </main>
  );
}

// ── Assets ──────────────────────────────────────────────────────────────

export function SiteAssets({ siteId, me }: { siteId: string; me: Me }) {
  const { site } = useSite(siteId);
  const [uploads, setUploads] = useState<{ id: string; fileName: string; url: string; createdAt: string }[] | null>(null);
  const [used, setUsed] = useState<LibraryAsset[] | null>(null);
  void me;
  useEffect(() => {
    Sites.uploads(siteId).then(setUploads, () => setUploads([]));
    Promise.all([Sites.head(siteId, "main"), Library.list({})])
      .then(([h, lib]) => {
        const json = JSON.stringify(h.document);
        setUsed(lib.filter((a) => json.includes(`/media/library/${a.id}.`)));
      })
      .catch(() => setUsed([]));
  }, [siteId]);
  return (
    <main className="page">
      <PageHead
        eyebrow="Site assets"
        title="Assets"
        sub="Approved library images this site uses, and files uploaded only to this site."
        actions={
          <a className="btn" href={`/assets${site?.market ? `?market=${site.market}` : ""}`} onClick={go(`/assets${site?.market ? `?market=${site.market}` : ""}`)}>
            <Icon name="image" size={14} /> Open the shared library
          </a>
        }
      />
      <section className="card">
        <div className="card-head">
          <div className="grow">
            <h2>From the shared library</h2>
            <span className="muted small">Publishing stops if any of these expire, lose approval, or aren't cleared for {site?.market ?? "this site's market"}.</span>
          </div>
        </div>
        <div className="card-body">
          {used === null && <div className="tm-loading small" />}
          {used?.length === 0 && <div className="empty">This site doesn't use library images yet.</div>}
          <div className="asset-cards">
            {used?.map((a) => {
              const marketOk = !a.markets.length || a.markets.includes("GLOBAL") || (!!site?.market && a.markets.includes(site.market));
              return (
                <a key={a.id} className="asset-card" href={`/assets?asset=${a.id}`} onClick={go(`/assets?asset=${a.id}`)}>
                  <img src={a.url} alt="" loading="lazy" />
                  <span className="asset-card-meta">
                    <strong>{a.title || a.fileName}</strong>
                    <span className="muted small mono">{a.jobCode ?? "No job code"}</span>
                    <span className="asset-pills">
                      {a.expired ? <Pill tone="danger">Rights expired</Pill> : <Pill tone={a.status === "approved" ? "ok" : "warn"}>{ASSET_STATUS_LABEL[a.status]}</Pill>}
                      {!marketOk && <Pill tone="danger">Not cleared for {site?.market ?? "market"}</Pill>}
                      {a.expiresAt && !a.expired && <Pill tone="muted">Until {new Date(a.expiresAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</Pill>}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <div className="grow">
            <h2>Uploaded to this site</h2>
            <span className="muted small">Site-only files. For anything regulated, prefer the shared library, where approval and rights are tracked.</span>
          </div>
        </div>
        <div className="card-body">
          {uploads === null && <div className="tm-loading small" />}
          {uploads?.length === 0 && <div className="empty">No site-only uploads.</div>}
          <div className="asset-cards">
            {uploads?.map((u) => (
              <a key={u.id} className="asset-card" href={u.url} target="_blank" rel="noreferrer">
                <img src={u.url} alt="" loading="lazy" />
                <span className="asset-card-meta">
                  <strong>{u.fileName}</strong>
                  <span className="muted small">{ago(u.createdAt)}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

// ── Activity and access ─────────────────────────────────────────────────

export function SiteActivity({ siteId, me }: { siteId: string; me: Me }) {
  const { site } = useSite(siteId);
  return (
    <main className="page">
      <PageHead eyebrow="Site governance" title="Activity and access" sub="Who changed what on this site, and who can open it." />
      <div className="cols">
        <section className="card">
          <div className="card-body">{site && me.role !== "agent" ? <ActivityLog siteId={siteId} slug={site.slug} onOpenVersion={(v) => navigate(`${siteUrl(siteId, "history")}?version=${v}`)} /> : null}</div>
        </section>
        <section className="card">
          <div className="card-body">{me.role !== "agent" && <AccessList siteId={siteId} me={me} />}</div>
        </section>
      </div>
    </main>
  );
}

// ── History ─────────────────────────────────────────────────────────────

export function SiteHistory({ siteId, me }: { siteId: string; me: Me }) {
  const { site } = useSite(siteId);
  const [warp, setWarp] = useState("");
  // Opens on a version when linked to one (?version=…); otherwise on request.
  const [tm, setTm] = useState<number | null>(() => Number(new URLSearchParams(location.search).get("version")) || null);
  const toast = useToast();
  return (
    <main className="page">
      <PageHead
        eyebrow="Site history"
        title="History"
        sub="Every saved version of this site, who made it, and what was live when."
        actions={
          <button className="btn primary" onClick={() => setTm(0)}>
            <Icon name="history" size={14} /> Open the time machine
          </button>
        }
      />
      <section className="card">
        <div className="card-body">
          <form
            className="ov-warp"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!warp) return;
              const r = await History.liveAt(siteId, new Date(warp).toISOString()).catch((err) => (toast({ text: err.message, tone: "error" }), null));
              if (!r) return;
              if (!r.live) toast({ text: `Nothing was live on ${new Date(warp).toLocaleString()}.` });
              else setTm(r.live.versionId);
            }}
          >
            <label className="small muted" htmlFor="ov-warp">
              See the live site as it was on
            </label>
            <div style={{ display: "flex", gap: 6, maxWidth: 420 }}>
              <input id="ov-warp" type="datetime-local" className="input" value={warp} onChange={(e) => setWarp(e.target.value)} />
              <button className="btn sm" disabled={!warp}>
                Show
              </button>
            </div>
          </form>
        </div>
      </section>
      {tm !== null && site && (
        <TimeMachineLazy siteId={siteId} siteName={site.name} me={me} initialVersion={tm || undefined} onClose={() => setTm(null)} />
      )}
    </main>
  );
}

function TimeMachineLazy({ siteId, siteName, me, initialVersion, onClose }: { siteId: string; siteName: string; me: Me; initialVersion?: number; onClose: () => void }) {
  const toast = useToast();
  return (
    <TimeMachine
      siteId={siteId}
      siteName={siteName}
      branch="main"
      canWrite={me.role !== "agent"}
      canShip={me.role !== "agent"}
      canName={me.role !== "agent"}
      initialVersion={initialVersion}
      toast={(text, tone) => toast({ text, tone })}
      onClose={onClose}
    />
  );
}

// ── Settings ────────────────────────────────────────────────────────────

export function SiteSettings({ siteId, me }: { siteId: string; me: Me }) {
  const { site, reload } = useSite(siteId);
  const { sites } = useShared();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState<{ name: string; domain: string; therapyArea: string; market: string; audience: string; jobCode: string } | null>(null);
  const [del, setDel] = useState("");
  const toast = useToast();
  const admin = me.role === "admin";
  useEffect(() => void Brands.list().then(setBrands, () => {}), []);
  useEffect(() => {
    if (site && !form) setForm({ name: site.name, domain: site.domain ?? "", therapyArea: site.therapyArea ?? "", market: site.market ?? "", audience: site.audience ?? "", jobCode: site.jobCode ?? "" });
  }, [site, form]);
  const areas = useMemo(() => [...new Set((sites ?? []).map((s) => s.therapyArea).filter(Boolean))] as string[], [sites]);
  if (!site || !form) return <main className="page"><div className="tm-loading" /></main>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (form.name !== site.name || form.domain !== (site.domain ?? "")) await Sites.update(siteId, { name: form.name.trim(), domain: form.domain.trim() || null });
      await Sites.profile(siteId, { therapyArea: form.therapyArea, market: form.market, audience: form.audience, jobCode: form.jobCode });
      toast({ text: "Saved" });
      void refreshShared();
      void reload();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    }
  };
  const policy = async (p: { reviewDisciplines?: string[]; requireJobCodes?: boolean; requiredApprovals?: number }) => {
    try {
      await Sites.policy(siteId, p);
      toast({ text: "Review rules updated" });
      void refreshShared();
      void reload();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    }
  };
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <main className="page">
      <PageHead
        eyebrow="Site settings"
        title="Settings"
        sub="Where this site sits in the portfolio, its review rules and its address."
        actions={
          <a className="btn" href={editorHref(siteId, { open: "settings" })} onClick={go(editorHref(siteId, { open: "settings" }))}>
            Languages, redirects and more <Icon name="arrow" size={13} />
          </a>
        }
      />
      <form className="card" onSubmit={save}>
        <div className="card-head">
          <div className="grow">
            <h2>Site and portfolio</h2>
            <span className="muted small">Filing a site makes it easy to find among hundreds, and sets the market its assets must be cleared for.</span>
          </div>
        </div>
        <div className="card-body form-grid">
          <label className="field-stack">
            <span className="small muted">Name</span>
            <input className="input" value={form.name} onChange={f("name")} required />
          </label>
          <label className="field-stack">
            <span className="small muted">Domain</span>
            <input className="input mono" placeholder="hcp.example.com" value={form.domain} onChange={f("domain")} />
          </label>
          <label className="field-stack">
            <span className="small muted">Therapy area</span>
            <input className="input" list="areas" placeholder="e.g. Immunology" value={form.therapyArea} onChange={f("therapyArea")} />
            <datalist id="areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label className="field-stack">
            <span className="small muted">Market</span>
            <input className="input mono" placeholder="US, GB, DE or GLOBAL" maxLength={6} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value.toUpperCase() })} />
          </label>
          <label className="field-stack">
            <span className="small muted">Audience</span>
            <select className="select" value={form.audience} onChange={f("audience")}>
              <option value="">Not set</option>
              {AUDIENCES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span className="small muted">Site job code</span>
            <input className="input mono" placeholder="US-CAL-2400123" value={form.jobCode} onChange={f("jobCode")} />
          </label>
        </div>
        <div className="card-foot">
          <span className="muted small">Brand: {site.brandName ?? "none"}. Pages get their own job codes in the editor's page settings.</span>
          <span className="grow" />
          <button className="btn primary">Save</button>
        </div>
      </form>

      <section className="card">
        <div className="card-head">
          <div className="grow">
            <h2>Review rules</h2>
            <span className="muted small">{admin ? "Who must sign off before a branch is merged, and what publishing needs." : "Only admins change these."}</span>
          </div>
        </div>
        <div className="card-body">
          <fieldset className="field-stack">
            <legend className="small muted">MLR sign-off (each one, by a reviewer for that discipline, with an electronic signature)</legend>
            <div className="check-row">
              {DISCIPLINES.map((d) => {
                const on = (site.reviewDisciplines ?? []).includes(d);
                return (
                  <label key={d} className="check">
                    <input type="checkbox" disabled={!admin} checked={on} onChange={() => void policy({ reviewDisciplines: on ? site.reviewDisciplines!.filter((x) => x !== d) : [...(site.reviewDisciplines ?? []), d] })} />
                    <span>{cap(d)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="check">
            <input type="checkbox" disabled={!admin} checked={!!site.requireJobCodes} onChange={() => void policy({ requireJobCodes: !site.requireJobCodes })} />
            <span>Every page needs a job code before the site is published</span>
          </label>
          <label className="field-stack" style={{ maxWidth: 320, marginTop: 12 }}>
            <span className="small muted">Approvals needed besides MLR</span>
            <select className="select" disabled={!admin} value={site.requiredApprovals ?? 0} onChange={(e) => void policy({ requiredApprovals: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "None" : `${n} ${n === 1 ? "person" : "people"}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {admin && (
        <section className="card">
          <div className="card-head">
            <h2>Brand</h2>
          </div>
          <div className="card-body">
            <select
              className="select"
              aria-label="Brand"
              style={{ maxWidth: 320 }}
              value={site.brandId ?? ""}
              onChange={(e) =>
                void Sites.setBrand(siteId, e.target.value || null).then(
                  () => (toast({ text: e.target.value ? "Brand applied as a new version on main" : "Stopped following the brand" }), void refreshShared(), void reload()),
                  (err) => toast({ text: err.message, tone: "error" }),
                )
              }
            >
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {me.role !== "agent" && (
        <section className="card danger-zone">
          <div className="card-head">
            <div className="grow">
              <h2>Delete this site</h2>
              <span className="muted small">Removes the site, its pages and history. The audit trail keeps a record that it existed.</span>
            </div>
          </div>
          <div className="card-body inline-form">
            <input className="input" aria-label="Type the site name to confirm" placeholder={`Type ${site.name} to confirm`} value={del} onChange={(e) => setDel(e.target.value)} />
            <button
              className="btn danger"
              disabled={del !== site.name}
              onClick={() =>
                void Sites.remove(siteId).then(
                  () => (toast({ text: `Deleted ${site.name}` }), void refreshShared(), navigate("/sites")),
                  (e) => toast({ text: e.message, tone: "error" }),
                )
              }
            >
              Delete site
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

