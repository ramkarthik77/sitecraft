import { useState } from "react";
import { CONTAINER_TYPES, type Operation, type SiteNode } from "@sitecraft/schema";
import { Icon } from "./Icon";

const GLYPH: Record<string, string> = {
  section: "▭",
  stack: "≡",
  grid: "▦",
  heading: "H",
  text: "Aa",
  image: "◩",
  button: "◉",
  link: "↗",
  divider: "—",
  spacer: "↕",
  form: "✎",
  input: "▢",
  embed: "▶",
  instance: "◆",
};

function glyphFor(n: SiteNode): string {
  if (n.type === "heading") return `H${Math.min(6, Math.max(1, Number(n.props.level) || 2))}`;
  return GLYPH[n.type] ?? "·";
}

export function nodeLabel(n: SiteNode): string {
  if (n.name) return n.name;
  const p = n.props;
  if (typeof p.text === "string" && p.text) return p.text.slice(0, 40);
  if (typeof p.label === "string" && p.label) return p.label;
  return n.type[0]!.toUpperCase() + n.type.slice(1);
}

export function Layers(props: {
  root: SiteNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  apply: (ops: Operation[]) => void;
  /** Ids Claude added or changed on this branch. */
  agentIds?: Set<string>;
  /** Tag shown on changed layers: "Claude" when only Claude edited the branch. */
  changeLabel?: string;
  /** Show only layers whose label matches. */
  filter?: string;
}) {
  const agentIds = props.agentIds ?? new Set<string>();
  const q = (props.filter ?? "").trim().toLowerCase();
  // With a filter, keep matching layers and the path to them.
  const keep = new Set<string>();
  if (q) {
    const visit = (n: SiteNode): boolean => {
      const own = nodeLabel(n).toLowerCase().includes(q) || n.type.includes(q);
      const kids = (n.children ?? []).map(visit).some(Boolean);
      if (own || kids) keep.add(n.id);
      return own || kids;
    };
    visit(props.root);
  }
  // Sections start collapsed; the path to the selection always opens.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const openPath = new Set<string>();
  if (props.selectedId) {
    const path = (n: SiteNode): boolean => {
      if (n.id === props.selectedId) return true;
      const hit = n.children?.some(path) ?? false;
      if (hit) openPath.add(n.id);
      return hit;
    };
    path(props.root);
  }
  const defaultOpen = (n: SiteNode, depth: number) => depth === 0 || openPath.has(n.id);
  const isCollapsed = (n: SiteNode, depth: number) => (q ? false : toggled.has(n.id) ? defaultOpen(n, depth) : !defaultOpen(n, depth));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; inside: boolean } | null>(null);

  const toggle = (id: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rows: { node: SiteNode; depth: number; parent: SiteNode | null; index: number }[] = [];
  const walk = (n: SiteNode, depth: number, parent: SiteNode | null, index: number) => {
    if (q && !keep.has(n.id)) return;
    rows.push({ node: n, depth, parent, index });
    if (!isCollapsed(n, depth)) n.children?.forEach((c, i) => walk(c, depth + 1, n, i));
  };
  walk(props.root, 0, null, 0);

  const isInside = (ancestor: string, id: string): boolean => {
    const find = (n: SiteNode): SiteNode | null => (n.id === ancestor ? n : n.children?.map(find).find(Boolean) ?? null);
    const a = find(props.root);
    const has = (n: SiteNode): boolean => n.id === id || !!n.children?.some(has);
    return !!a && has(a);
  };

  const drop = (target: (typeof rows)[number], inside: boolean) => {
    if (!drag || drag === target.node.id || isInside(drag, target.node.id)) return;
    if (inside && CONTAINER_TYPES.has(target.node.type)) {
      props.apply([{ op: "move_node", nodeId: drag, parentId: target.node.id }]);
    } else if (target.parent) {
      // Moving within the same parent shifts indexes once the node is removed.
      const from = target.parent.children!.findIndex((c) => c.id === drag);
      const idx = from >= 0 && from < target.index ? target.index - 1 : target.index;
      props.apply([{ op: "move_node", nodeId: drag, parentId: target.parent.id, index: idx }]);
    }
  };

  if (q && rows.length === 0) return <div className="empty">No layers match “{props.filter}”.</div>;

  return (
    <div role="tree" aria-label="Layers">
      {rows.map((r) => {
        const n = r.node;
        const hasKids = !!n.children?.length;
        const byAgent = agentIds.has(n.id);
        const cls = ["layer", props.selectedId === n.id ? "selected" : "", byAgent ? "agent" : "", over?.id === n.id ? (over.inside ? "drop-inside" : "drop-before") : ""].join(" ");
        return (
          <div
            key={n.id}
            role="treeitem"
            aria-selected={props.selectedId === n.id}
            aria-expanded={hasKids ? !isCollapsed(n, r.depth) : undefined}
            className={cls}
            style={{ paddingLeft: 4 + r.depth * 14 }}
            draggable={!!r.parent}
            onDragStart={(e) => {
              setDrag(n.id);
              e.dataTransfer.setData("text/plain", `move:${n.id}`);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const inside = CONTAINER_TYPES.has(n.type) && e.clientY > rect.top + rect.height * 0.5;
              setOver({ id: n.id, inside: inside || !r.parent });
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              drop(r, over?.inside ?? false);
              setOver(null);
              setDrag(null);
            }}
            onClick={() => props.onSelect(n.id)}
          >
            <span
              className="twisty"
              onClick={(e) => {
                e.stopPropagation();
                if (hasKids) toggle(n.id);
              }}
            >
              {hasKids ? (isCollapsed(n, r.depth) ? "▸" : "▾") : ""}
            </span>
            <span className="kind" aria-hidden="true">
              {glyphFor(n)}
            </span>
            <span className={`label ${n.hidden?.base ? "dim" : ""}`}>{nodeLabel(n)}</span>
            {byAgent && r.depth > 0 && <span className="agent-tag">{props.changeLabel ?? "Claude"}</span>}
            {!byAgent && n.type === "instance" && <span className="tag">Component</span>}
            {r.parent && (
              <span className="actions">
                <button
                  className="btn ghost icon sm"
                  title="Duplicate"
                  aria-label="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.apply([{ op: "duplicate_node", nodeId: n.id }]);
                  }}
                >
                  <Icon name="copy" size={13} />
                </button>
                <button
                  className="btn ghost icon sm danger"
                  title="Delete"
                  aria-label="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.apply([{ op: "remove_node", nodeId: n.id }]);
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
