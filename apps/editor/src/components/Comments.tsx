import { useState } from "react";
import { Comments, type Comment, type Me } from "../api";
import { ago, initials } from "../format";
import { Icon } from "./Icon";

export interface CommentTarget {
  kind: "site" | "node" | "item";
  id?: string;
  label: string;
}

/** Comments on this branch: new comment, threads with replies, resolve and reopen. */
export function CommentsPanel(props: {
  siteId: string;
  branch: string;
  me: Me;
  comments: Comment[];
  target: CommentTarget;
  onClearTarget: () => void;
  onChanged: () => void;
  onFocus: (c: Comment) => void;
  toast: (m: string, tone?: "error") => void;
}) {
  const [text, setText] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const threads = props.comments.filter((c) => !c.parentId);
  const open = threads.filter((t) => !t.resolvedAt);
  const resolved = threads.filter((t) => t.resolvedAt);
  const replies = (id: string) => props.comments.filter((c) => c.parentId === id);

  const send = async (body: string, parentId?: string) => {
    try {
      await Comments.add(props.siteId, {
        branch: props.branch,
        body,
        parentId,
        ...(parentId ? {} : { targetKind: props.target.kind, targetId: props.target.id, targetLabel: props.target.label }),
      });
      props.onChanged();
      return true;
    } catch (e) {
      props.toast((e as Error).message, "error");
      return false;
    }
  };

  return (
    <div className="comments">
      <form
        className="comment-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await send(text.trim()))) setText("");
        }}
      >
        <span className="small muted">
          On <b>{props.target.label}</b>
          {props.target.kind !== "site" && (
            <button type="button" className="linkish" style={{ marginLeft: 6 }} onClick={props.onClearTarget}>
              comment on the whole site instead
            </button>
          )}
        </span>
        <textarea className="textarea" aria-label="New comment" placeholder="Comment, or @mention someone, e.g. @Claude make this shorter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.currentTarget.form as HTMLFormElement).requestSubmit()} />
        <button className="btn sm primary" disabled={!text.trim()} style={{ alignSelf: "flex-end" }}>
          Comment
        </button>
      </form>
      {open.length === 0 && <div className="muted small">No open comments on {props.branch}.</div>}
      {open.map((t) => (
        <Thread key={t.id} t={t} replies={replies(t.id)} {...props} send={send} />
      ))}
      {resolved.length > 0 && (
        <button className="linkish small" onClick={() => setShowResolved((x) => !x)}>
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      )}
      {showResolved && resolved.map((t) => <Thread key={t.id} t={t} replies={replies(t.id)} {...props} send={send} />)}
    </div>
  );
}

function Bubble({ c, me }: { c: Comment; me: Me }) {
  const agent = c.authorRole === "agent";
  return (
    <div className="bubble">
      <span className={`avatar sm ${agent ? "agent" : ""}`} aria-hidden="true">
        {agent ? <Icon name="spark" size={11} /> : initials(c.author)}
      </span>
      <div className="bubble-body">
        <div className="small">
          <b>{c.author === me.name ? "You" : c.author}</b> <span className="muted">{ago(c.createdAt)}</span>
        </div>
        <div className="bubble-text">
          {c.body.split(/(@[\p{L}\p{N}_.-]+)/u).map((part, i) => (part.startsWith("@") ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
        </div>
      </div>
    </div>
  );
}

function Thread(props: {
  t: Comment;
  replies: Comment[];
  siteId: string;
  me: Me;
  onChanged: () => void;
  onFocus: (c: Comment) => void;
  toast: (m: string, tone?: "error") => void;
  send: (body: string, parentId?: string) => Promise<boolean>;
}) {
  const { t } = props;
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  return (
    <article className={`thread ${t.resolvedAt ? "resolved" : ""}`}>
      <div className="thread-head">
        {t.targetKind === "site" ? (
          <span className="small muted">Whole site</span>
        ) : (
          <button className="linkish small" onClick={() => props.onFocus(t)} title="Show it on the canvas">
            {t.targetLabel || "Element"}
          </button>
        )}
        <span className="spacer" />
        <button
          className="btn ghost sm"
          onClick={async () => {
            try {
              await Comments.resolve(props.siteId, t.id, !t.resolvedAt);
              props.onChanged();
            } catch (e) {
              props.toast((e as Error).message, "error");
            }
          }}
        >
          {t.resolvedAt ? "Reopen" : <><Icon name="check" size={13} /> Resolve</>}
        </button>
      </div>
      <Bubble c={t} me={props.me} />
      {props.replies.map((r) => (
        <Bubble key={r.id} c={r} me={props.me} />
      ))}
      {t.resolvedAt ? (
        <span className="muted small">Resolved by {t.resolvedBy} {ago(t.resolvedAt)}</span>
      ) : replying ? (
        <form
          className="reply"
          onSubmit={async (e) => {
            e.preventDefault();
            if (reply.trim() && (await props.send(reply.trim(), t.id))) (setReply(""), setReplying(false));
          }}
        >
          <input className="input" autoFocus aria-label="Reply" placeholder="Reply" value={reply} onChange={(e) => setReply(e.target.value)} />
          <button className="btn sm" disabled={!reply.trim()}>
            Reply
          </button>
        </form>
      ) : (
        <button className="linkish small" style={{ alignSelf: "flex-start" }} onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </article>
  );
}
