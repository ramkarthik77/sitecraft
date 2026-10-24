import { useEffect, useMemo, useState } from "react";
import { createStarterDocument, findCollection, languageName, type SiteDocument } from "@sitecraft/schema";
import { Brands, Sites, Templates, Tokens, type Branch, type Deployment, type Me, type SavedTemplate, type SiteSummary } from "../api";
import { ago } from "../format";
import { navigate } from "../router";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";
import { DocThumb } from "../App";
import { orderedPages, templatePages } from "./PageSwitcher";

/**
 * The first screens people see: Home (what to do next), the new-site picker,
 * and a site's overview (its pages, status and changes, before the editor).
 */

const go = (href: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  navigate(href);
};

export const overviewUrl = (siteId: string) => `/sites/${siteId}/overview`;
export const editorUrl = (siteId: string, q: Record<string, string> = {}) => {
  const s = new URLSearchParams(q).toString();
  return `/sites/${siteId}${s ? `?${s}` : ""}`;
};

export interface PendingReview {
  site: SiteSummary;
  branch: Branch;
}

/** Sites and branches waiting for review, loaded once per screen. */
export function useSitesAndReviews() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [claudeSeen, setClaudeSeen] = useState(false);
  const toast = useToast();
  useEffect(() => {
    Sites.list()
      .then(async (list) => {
        setSites(list);
        const all = await Promise.all(list.map((s) => Sites.branches(s.id).then((bs) => bs.map((b) => ({ site: s, branch: b }))).catch(() => [] as PendingReview[])));
        const flat = all.flat();
        setClaudeSeen(flat.some((r) => /claude|agent/i.test(r.branch.lastChangeBy) || /claude|agent/i.test(r.branch.createdBy)));
        setReviews(flat.filter((r) => r.branch.name !== "main" && r.branch.hasChanges).sort((a, b) => b.branch.updatedAt.localeCompare(a.branch.updatedAt)));
      })
      .catch((e) => toast({ text: e.message, tone: "error" }));
  }, [toast]);
  return { sites, reviews, claudeSeen };
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

// ── Home ────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  title: string;
  why: string;
  done: boolean;
  action: React.ReactNode;
}

export function HomePage({ me, connectCommand }: { me: Me; connectCommand: string }) {
  const { sites, reviews, claudeSeen } = useSitesAndReviews();
  const [creating, setCreating] = useState(false);
  const [brands, setBrands] = useState<number | null>(null);
  const [people, setPeople] = useState<number | null>(null);
  const [agentTokens, setAgentTokens] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("sitecraft.home.guide") === "hidden";
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  const admin = me.role === "admin";
  const editor = me.role !== "agent";

  useEffect(() => {
    Brands.list()
      .then((b) => setBrands(b.length))
      .catch(() => setBrands(0));
    if (admin && !me.local)
      Tokens.list()
        .then((t) => {
          const active = t.filter((x) => !x.revokedAt && !(x.expiresAt && new Date(x.expiresAt) < new Date()));
          setPeople(active.filter((x) => x.role !== "agent").length);
          setAgentTokens(active.filter((x) => x.role === "agent").length);
        })
        .catch(() => setPeople(0));
  }, [admin, me.local]);

  const recent = useMemo(() => [...(sites ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 4), [sites]);
  const firstSite = recent[0];
  const copy = () =>
    void navigator.clipboard?.writeText(connectCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  const steps: Step[] = [
    {
      key: "site",
      title: "Create your first site",
      why: "Start from a template; you can change everything.",
      done: (sites?.length ?? 0) > 0,
      action: editor && (
        <button className="btn sm primary" onClick={() => setCreating(true)}>
          New site
        </button>
      ),
    },
    {
      key: "publish",
      title: "Publish it",
      why: "Open the site, then Publish. It goes live at its own address.",
      done: (sites ?? []).some((s) => !!s.liveUrl),
      action: firstSite && (
        <a className="btn sm" href={overviewUrl(firstSite.id)} onClick={go(overviewUrl(firstSite.id))}>
          Open {firstSite.name}
        </a>
      ),
    },
    ...(admin
      ? [
          {
            key: "brand",
            title: "Set up your brand",
            why: "Colors, fonts, header and footer that every site follows.",
            done: (brands ?? 0) > 0,
            action: (
              <a className="btn sm" href="/brands" onClick={go("/brands")}>
                Go to Brands
              </a>
            ),
          },
        ]
      : []),
    ...(admin && !me.local
      ? [
          {
            key: "people",
            title: "Invite your team",
            why: "Give each person their own sign-in; you stay the admin.",
            done: (people ?? 0) > 1,
            action: (
              <a className="btn sm" href="/access" onClick={go("/access")}>
                Go to Access
              </a>
            ),
          },
        ]
      : []),
    {
      key: "claude",
      title: "Connect Claude Code",
      why: "Ask Claude to build pages; it works on a branch for you to review.",
      done: claudeSeen || agentTokens > 0,
      action: (
        <button className="btn sm agent-outline" onClick={copy}>
          <Icon name="copy" size={12} /> {copied ? "Copied" : "Copy the connect command"}
        </button>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const showGuide = sites !== null && !(hidden && doneCount > 0) && doneCount < steps.length;
  const hideGuide = () => {
    setHidden(true);
    try {
      localStorage.setItem("sitecraft.home.guide", "hidden");
    } catch {
      /* private window */
    }
  };

  return (
    <main className="dash-main home">
      <header className="home-head">
        <div>
          <h1>
            {greeting()}
            {me.name && me.name !== "You" ? `, ${me.name.split(" ")[0]}` : ""}
          </h1>
          <p className="muted">Build, review and publish your team's websites, with Claude.</p>
        </div>
        <div className="spacer" />
        {editor && (
          <button className="btn primary" style={{ height: 38 }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New site
          </button>
        )}
      </header>

      {showGuide && (
        <section className="guide" aria-labelledby="guide-title">
          <div className="guide-top">
            <h2 id="guide-title">Get started</h2>
            <span className="muted">
              {doneCount} of {steps.length} done
            </span>
            <span className="guide-bar" aria-hidden="true">
              <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </span>
            {doneCount > 0 && (
              <button className="btn ghost sm" onClick={hideGuide}>
                Hide
              </button>
            )}
          </div>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.key} className={s.done ? "done" : ""}>
                <span className="num" aria-hidden="true">
                  {s.done ? <Icon name="check" size={13} /> : i + 1}
                </span>
                <span className="grow">
                  <strong>{s.title}</strong>
                  <span className="muted">{s.done ? "Done" : s.why}</span>
                </span>
                {!s.done && s.action}
              </li>
            ))}
          </ol>
        </section>
      )}

      {reviews.length > 0 && (
        <section aria-labelledby="home-reviews">
          <h2 id="home-reviews">
            Waiting for your review <span className="muted">{reviews.length}</span>
          </h2>
          <div className="review-list">
            {reviews.slice(0, 5).map((r) => {
              const href = editorUrl(r.site.id, { branch: r.branch.name, review: "1" });
              return (
                <a key={`${r.site.id}:${r.branch.name}`} className="review-row" href={href} onClick={go(href)}>
                  <span className="branch">{r.branch.name}</span>
                  <span className="grow">
                    <strong>{r.site.name}</strong>
                    <span className="muted">
                      {/claude|agent/i.test(r.branch.lastChangeBy) ? "Claude" : r.branch.lastChangeBy}: {r.branch.lastMessage || "Changes ready"}
                    </span>
                  </span>
                  <span className="muted small">{ago(r.branch.updatedAt)}</span>
                  <span className="btn sm agent">Review</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="home-recent">
          <div className="section-head">
            <h2 id="home-recent">Recent sites</h2>
            <a className="link-more" href="/sites" onClick={go("/sites")}>
              All {sites!.length} sites <Icon name="back" size={12} style={{ transform: "rotate(180deg)" }} />
            </a>
          </div>
          <div className="site-grid">
            {recent.map((s) => (
              <SiteCard key={s.id} site={s} inReview={reviews.some((r) => r.site.id === s.id)} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="home-map">
        <h2 id="home-map">How Sitecraft fits together</h2>
        <div className="concepts">
          <Concept href="/sites" icon="grid" title="Sites" body="Each site has pages, CMS content like blog posts, and its own web address." />
          <Concept href="/templates" icon="pages" title="Templates" body="Starting points for new sites, made by saving a site you like." />
          <Concept href="/brands" icon="spark" title="Brands" body="Colors, fonts, logo, header and footer that a group of sites shares." />
          <Concept href="/assets" icon="image" title="Assets" body="Approved images every site can use, with alt text and credits." />
        </div>
        <ol className="flow" aria-label="How a change goes live">
          <li>
            <strong>Edit</strong>
            <span>You, or Claude on its own branch</span>
          </li>
          <li>
            <strong>Review</strong>
            <span>See the changes, comment, approve</span>
          </li>
          <li>
            <strong>Publish</strong>
            <span>Live in a minute; roll back any time</span>
          </li>
        </ol>
      </section>

      {creating && <NewSiteDialog onClose={() => setCreating(false)} />}
    </main>
  );
}

function Concept({ href, icon, title, body }: { href: string; icon: string; title: string; body: string }) {
  return (
    <a className="concept" href={href} onClick={go(href)}>
      <Icon name={icon} size={16} />
      <strong>{title}</strong>
      <span>{body}</span>
    </a>
  );
}

/** One site: thumbnail, status and address. Opens the site's overview. */
export function SiteCard({ site, inReview, index = 0 }: { site: SiteSummary; inReview?: boolean; index?: number }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  useEffect(() => {
    Sites.head(site.id, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
  }, [site.id]);
  const href = overviewUrl(site.id);
  return (
    <div className="site-card tilt" style={{ ["--i" as string]: Math.min(index, 12) }}>
      <a className="card-link" href={href} onClick={go(href)} aria-label={`${site.name}: overview`}>
        <DocThumb doc={doc} />
      </a>
      <div className="meta">
        <strong>
          <a href={href} onClick={go(href)}>
            {site.name}
          </a>
          {inReview ? <span className="status review">In review</span> : site.liveUrl ? <span className="status live">Live</span> : <span className="status draft">Draft</span>}
        </strong>
        <span className="sub">
          {site.liveUrl ? site.liveUrl.replace(/^https?:\/\//, "") : "Not published"}
          {site.updatedAt ? ` · edited ${ago(site.updatedAt)}` : ""}
        </span>
      </div>
      <a className="btn sm card-edit" href={editorUrl(site.id)} onClick={go(editorUrl(site.id))}>
        Edit
      </a>
    </div>
  );
}

// ── New site ────────────────────────────────────────────────────────────

const STARTERS: { id: "landing" | "saas" | "blog" | "blank"; name: string; about: string }[] = [
  { id: "landing", name: "Landing page", about: "One page: hero, features, call to action" },
  { id: "saas", name: "Product site", about: "Features, pricing, FAQ and testimonials" },
  { id: "blog", name: "Blog", about: "Posts from the CMS, with a post page" },
  { id: "blank", name: "Blank", about: "An empty page to build from scratch" },
];

export function NewSiteDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [choice, setChoice] = useState("landing");
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [savedDocs, setSavedDocs] = useState<Record<string, SiteDocument>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const starters = useMemo(() => Object.fromEntries(STARTERS.map((s) => [s.id, createStarterDocument({ name: "Your site", template: s.id })])), []);

  useEffect(() => {
    Templates.list()
      .then((list) => {
        setSaved(list);
        // Thumbnails for the first few saved templates.
        for (const t of list.slice(0, 6))
          Templates.get(t.id)
            .then((full) => setSavedDocs((d) => ({ ...d, [t.id]: full.document })))
            .catch(() => {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = choice.startsWith("t:") ? await Sites.create(name.trim(), "", choice.slice(2)) : await Sites.create(name.trim(), choice);
      navigate(editorUrl(s.id));
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };

  const option = (id: string, title: string, about: string, doc: SiteDocument | null, extra?: string) => (
    <label key={id} className={`tpl ${choice === id ? "on" : ""}`}>
      <input type="radio" name="template" value={id} checked={choice === id} onChange={() => setChoice(id)} />
      <DocThumb doc={doc} />
      <strong>{title}</strong>
      <span className="muted small">{about}</span>
      {extra && <span className="type-chip">{extra}</span>}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal new-site" role="dialog" aria-modal="true" aria-labelledby="new-site-title" onSubmit={create}>
        <header>
          <h2 id="new-site-title">New site</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <label className="field-stack">
          <span className="small muted">Name</span>
          <input className="input" aria-label="Site name" autoFocus placeholder="e.g. Northstar Coffee" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="tpl-group" aria-label="Template">
          <legend className="small muted">Start from</legend>
          <div className="tpl-grid">{STARTERS.map((s) => option(s.id, s.name, s.about, starters[s.id]!))}</div>
          {saved.length > 0 && (
            <>
              <legend className="small muted" style={{ marginTop: 14 }}>
                Your templates
              </legend>
              <div className="tpl-grid">
                {saved.map((t) => option(`t:${t.id}`, t.name, t.description || `${t.pages ?? ""} pages`.trim(), savedDocs[t.id] ?? null, t.brandName ?? undefined))}
              </div>
            </>
          )}
        </fieldset>
        <footer>
          <span className="muted small">You can change everything after it's created.</span>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create site"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ── Site overview ───────────────────────────────────────────────────────

export function SiteOverview({ siteId, me }: { siteId: string; me: Me }) {
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [deploys, setDeploys] = useState<Deployment[]>([]);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Sites.get(siteId)
      .then(setSite)
      .catch((e) => (toast({ text: e.message, tone: "error" }), navigate("/sites")));
    Sites.head(siteId, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
    Sites.branches(siteId)
      .then(setBranches)
      .catch(() => {});
    Sites.deployments(siteId)
      .then(setDeploys)
      .catch(() => {});
  }, [siteId, toast]);

  const preview = async () => {
    const w = window.open("", "_blank");
    const { url } = await Sites.previewUrl(siteId, "main");
    if (w) w.location.href = url;
  };
  const pending = branches.filter((b) => b.name !== "main" && b.hasChanges);
  const lastLive = deploys.find((d) => d.current) ?? deploys[0];
  const pageUrl = (path: string) => (site?.liveUrl ? `${site.liveUrl.replace(/\/$/, "")}${path === "/" ? "/" : path}` : null);
  // Same order as the editor: Home, then sub-pages under their parent, then CMS item pages.
  const pages = doc ? [...orderedPages(doc), ...templatePages(doc).map((t) => ({ page: t.page, depth: 0, label: t.page.title }))] : [];

  return (
    <main className="dash-main overview">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/sites" onClick={go("/sites")}>
          Sites
        </a>
        <span aria-hidden="true">/</span>
        <span className="current">{site?.name ?? "…"}</span>
      </nav>

      <header className="ov-head">
        <div className="ov-thumb">
          <DocThumb doc={doc} />
        </div>
        <div className="ov-title">
          <h1>
            {site?.name ?? " "}
            {site && (site.liveUrl ? <span className="status live">Live</span> : <span className="status draft">Draft</span>)}
          </h1>
          {site?.liveUrl ? (
            <p className="ov-url">
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
            <p className="muted">Not published yet. Open the editor and click Publish to put it live.</p>
          )}
          <div className="ov-actions">
            <a className="btn primary" href={editorUrl(siteId)} onClick={go(editorUrl(siteId))}>
              Open editor
            </a>
            <button className="btn" onClick={() => void preview()}>
              <Icon name="eye" size={13} /> Preview
            </button>
            {me.role !== "agent" && (
              <a className="btn ghost" href={editorUrl(siteId, { open: "settings" })} onClick={go(editorUrl(siteId, { open: "settings" }))}>
                <Icon name="settings" size={13} /> Settings
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="ov-cols">
        <div className="ov-main">
          {pending.length > 0 && (
            <section aria-labelledby="ov-review">
              <h2 id="ov-review">
                Changes waiting for review <span className="muted">{pending.length}</span>
              </h2>
              <div className="review-list">
                {pending.map((b) => {
                  const href = editorUrl(siteId, { branch: b.name, review: "1" });
                  return (
                    <a key={b.name} className="review-row" href={href} onClick={go(href)}>
                      <span className="branch">{b.name}</span>
                      <span className="grow">
                        <span className="muted">
                          {/claude|agent/i.test(b.lastChangeBy) ? "Claude" : b.lastChangeBy}: {b.lastMessage || "Changes ready"}
                        </span>
                      </span>
                      <span className="muted small">{ago(b.updatedAt)}</span>
                      <span className="btn sm agent">Review</span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          <section aria-labelledby="ov-pages">
            <div className="section-head">
              <h2 id="ov-pages">
                Pages <span className="muted">{pages.length}</span>
              </h2>
              <a className="btn sm" href={editorUrl(siteId, { tab: "pages", new: "page" })} onClick={go(editorUrl(siteId, { tab: "pages", new: "page" }))}>
                <Icon name="plus" size={12} /> New page
              </a>
            </div>
            <div className="page-table" role="table" aria-label="Pages">
              {pages.map(({ page: p, depth }) => {
                const col = p.collectionId && doc ? findCollection(doc, p.collectionId) : undefined;
                const live = !col && !p.unpublished ? pageUrl(p.path) : null;
                const edit = editorUrl(siteId, { page: p.id });
                return (
                  <div key={p.id} className="page-row" role="row" style={{ paddingLeft: 14 + depth * 22 }}>
                    <Icon name={col ? "database" : "pages"} size={14} style={col ? { color: "var(--cms)" } : undefined} />
                    <a className="grow page-name" href={edit} onClick={go(edit)} role="cell">
                      <strong>{p.path === "/" ? "Home" : p.title}</strong>
                      <span className="mono muted">{p.path}</span>
                    </a>
                    <span role="cell">
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
            <section aria-labelledby="ov-cms">
              <h2 id="ov-cms">CMS content</h2>
              <div className="cms-cards">
                {doc!.collections!.map((c) => {
                  const href = editorUrl(siteId, { tab: "cms", cms: c.id });
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

        <aside className="ov-facts" aria-label="About this site">
          <dl>
            <dt>Last published</dt>
            <dd>{lastLive ? `${ago(lastLive.createdAt)} by ${lastLive.actor}` : "Never"}</dd>
            <dt>Brand</dt>
            <dd>{doc?.brand ? `${doc.brand.name}${doc.brand.locked ? " (locked)" : ""}` : "None"}</dd>
            <dt>Languages</dt>
            <dd>{doc ? [doc.settings.lang, ...(doc.settings.locales ?? [])].map(languageName).join(", ") : "…"}</dd>
            <dt>Approvals to publish</dt>
            <dd>{site?.requiredApprovals ? `${site.requiredApprovals} required` : "None required"}</dd>
            <dt>Address</dt>
            <dd className="mono">{site?.domain ?? site?.slug ?? "…"}</dd>
          </dl>
          <a className="btn ghost sm" href={editorUrl(siteId, { open: "history" })} onClick={go(editorUrl(siteId, { open: "history" }))}>
            <Icon name="history" size={13} /> History and published versions
          </a>
        </aside>
      </div>
    </main>
  );
}
