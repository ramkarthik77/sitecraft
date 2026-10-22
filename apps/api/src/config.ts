export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Public base URL of this API, e.g. http://localhost:4000 */
  publicUrl: string;
  /** Where people open the editor, used in links handed to agents. */
  editorUrl: string;
  /** If set, published sites are served at https://<slug>.<sitesDomain>. */
  sitesDomain?: string;
  secret: string;
  storage:
    | { driver: "fs"; dir: string }
    | { driver: "s3"; bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
  /** Seed tokens created at startup (handy for local dev). */
  seedTokens: { token: string; name: string; role: "admin" | "editor" | "agent" }[];
  agentCanPublish: boolean;
  agentCanEditMain: boolean;
  editorDist?: string;
  corsOrigins: string[];
  /**
   * Local app mode: single user on this computer. Requests from this machine
   * need no token and act as the owner; tokens still work (Claude Code uses one).
   */
  local: boolean;
}

function bool(v: string | undefined, d: boolean) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 4000);
  const local = bool(env.SITECRAFT_LOCAL, false);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
  const seedTokens: Config["seedTokens"] = [];
  if (env.ADMIN_TOKEN) seedTokens.push({ token: env.ADMIN_TOKEN, name: "admin (seed)", role: "admin" });
  if (env.EDITOR_TOKEN) seedTokens.push({ token: env.EDITOR_TOKEN, name: "editor (seed)", role: "editor" });
  if (env.AGENT_TOKEN) seedTokens.push({ token: env.AGENT_TOKEN, name: local ? "Claude Code" : "claude-code (seed)", role: "agent" });
  const secret = env.SECRET ?? "";
  if (env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("SECRET must be at least 32 characters in production");
  }
  return {
    port,
    // The local app only listens on this computer.
    host: env.HOST ?? (local ? "127.0.0.1" : "0.0.0.0"),
    databaseUrl: env.DATABASE_URL ?? "postgres://sitecraft:sitecraft@localhost:5432/sitecraft",
    publicUrl,
    editorUrl: (env.EDITOR_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    sitesDomain: env.SITES_DOMAIN || undefined,
    secret: secret || "dev-secret-change-me-dev-secret-change-me",
    storage:
      env.STORAGE_DRIVER === "s3"
        ? {
            driver: "s3",
            bucket: env.S3_BUCKET ?? "sitecraft",
            region: env.S3_REGION ?? "us-east-1",
            endpoint: env.S3_ENDPOINT || undefined,
            accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
            forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, !!env.S3_ENDPOINT),
          }
        : { driver: "fs", dir: env.STORAGE_DIR ?? "./data/storage" },
    seedTokens,
    agentCanPublish: bool(env.AGENT_CAN_PUBLISH, false),
    agentCanEditMain: bool(env.AGENT_CAN_EDIT_MAIN, false),
    editorDist: env.EDITOR_DIST || undefined,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
    local,
  };
}
