import pg from "pg";

export interface SiteEvent {
  type: "version" | "branch" | "deploy";
  siteId: string;
  branch?: string;
  versionId?: number;
  actor: string;
  actorRole: string;
  message?: string;
  at: string;
}

type Listener = (e: SiteEvent) => void;

const CHANNEL = "sitecraft_events";

/**
 * Change notifications over Postgres LISTEN/NOTIFY, so every API instance can
 * tell open editors that an agent (or a teammate) just changed a page.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(private databaseUrl: string) {}

  async start() {
    this.stopped = false;
    await this.connect();
  }

  private async connect() {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const e = JSON.parse(msg.payload) as SiteEvent;
        this.listeners.get(e.siteId)?.forEach((l) => l(e));
      } catch {
        /* ignore malformed payloads */
      }
    });
    client.on("error", () => {
      this.client = null;
      if (!this.stopped) setTimeout(() => this.connect().catch(() => {}), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
  }

  async stop() {
    this.stopped = true;
    await this.client?.end().catch(() => {});
    this.client = null;
  }

  subscribe(siteId: string, fn: Listener): () => void {
    let set = this.listeners.get(siteId);
    if (!set) this.listeners.set(siteId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(siteId);
    };
  }

  static async publish(q: { query: (sql: string, params: unknown[]) => Promise<unknown> }, e: Omit<SiteEvent, "at">) {
    await q.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ ...e, at: new Date().toISOString() })]);
  }
}
