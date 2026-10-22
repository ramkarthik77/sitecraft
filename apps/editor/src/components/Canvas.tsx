import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderPageParts } from "@sitecraft/renderer";
import { BREAKPOINT_CANVAS_WIDTH, type Breakpoint, type Page, type SiteDocument } from "@sitecraft/schema";

export type CanvasEvent =
  | { type: "select"; id: string | null }
  | { type: "text"; id: string; text: string }
  | { type: "drop"; id: string | null; payload: string; before: boolean }
  | { type: "key"; key: string; meta: boolean; shift: boolean };

/**
 * The canvas renders pages with the same renderer used for publishing, inside
 * an iframe sized to the breakpoint, so media queries and layout match the live site.
 */
// The bridge script that runs inside the canvas lives in public/canvas-bridge.js.


const UI_CSS = `
[data-node-id].sc-hov{outline:1px solid rgba(91,140,255,.7);outline-offset:-1px}
[data-node-id].sc-agent{outline:1.5px dashed #9b6cf0;outline-offset:-3px}
[data-node-id].sc-sel{outline:2px solid #5b8cff!important;outline-offset:-2px}
[data-node-id][contenteditable="true"],[data-node-id][contenteditable="plaintext-only"]{outline:2px solid #5b8cff!important;outline-offset:2px;cursor:text}
.sc-drop-before{box-shadow:0 -3px 0 #5b8cff}
.sc-drop-after{box-shadow:0 3px 0 #5b8cff}
#sc-overlay{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647}
.sc-tag{position:absolute;transform-origin:0 0;white-space:nowrap;font:500 10px/1 "Geist Mono",ui-monospace,Menlo,monospace;padding:4px 6px;border-radius:4px;pointer-events:none}
.sc-tag-sel{background:#5b8cff;color:#fff}
.sc-tag-agent{background:#2a1f3d;color:#e9dcff;font-family:"Geist",system-ui,sans-serif;font-size:11px;padding:4px 8px;border-radius:999px}
.sc-tag-comment{background:#f5b94a;color:#2b1d00;font-family:"Geist",system-ui,sans-serif;font-size:11px;min-width:18px;height:18px;padding:0 5px;border-radius:9px 9px 9px 2px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3)}
[data-bound="1"].sc-sel{outline-color:#2bb5a3!important}
[data-node-type="richtext"]:empty{min-height:40px;background:repeating-linear-gradient(45deg,#f3f4f1,#f3f4f1 6px,#fff 6px,#fff 12px)}
[data-node-type="stack"]:empty,[data-node-type="grid"]:empty,[data-node-type="section"]:empty,[data-node-type="form"]:empty{min-height:56px;background:repeating-linear-gradient(45deg,#f3f4f1,#f3f4f1 6px,#fff 6px,#fff 12px)}
a,button{cursor:default}
`;

export function Canvas(props: {
  doc: SiteDocument;
  page: Page;
  breakpoint: Breakpoint;
  selectedId: string | null;
  zoom: number;
  scrollToSelected: number;
  /** Top-most elements Claude added or changed on this branch. */
  agentIds?: string[];
  agentLabel?: string;
  pageLabel?: string;
  /** On a template page: the collection item to show. */
  itemId?: string;
  /** Open comment threads per element id, shown as markers. */
  commentCounts?: Record<string, number>;
  /** Show the page in this language. */
  locale?: string;
  onEvent: (e: CanvasEvent) => void;
}) {
  const { doc, page, breakpoint, selectedId, onEvent } = props;
  const iframe = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(800);
  const [fit, setFit] = useState(1);
  const width = BREAKPOINT_CANVAS_WIDTH[breakpoint];
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const parts = useMemo(() => renderPageParts(doc, page, { mode: "editor", itemId: props.itemId, locale: props.locale }), [doc, page, props.itemId, props.locale]);

  const shell = useMemo(
    () =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500&family=Geist+Mono:wght@500&display=swap">` +
      `<style id="sc-css"></style><style>${UI_CSS}</style></head><body><div id="sc-root"></div><div id="sc-overlay"></div><script src="/canvas-bridge.js"></script></body></html>`,
    [],
  );

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "sc-canvas" || e.source !== iframe.current?.contentWindow) return;
      if (d.type === "ready") setReady(true);
      else if (d.type === "height") setHeight(d.h);
      else if (d.type === "scrollTo" && stage.current) stage.current.scrollTo({ top: Math.max(0, d.y * fitRef.current - 80), behavior: "smooth" });
      else onEventRef.current(d as CanvasEvent);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  const post = (m: Record<string, unknown>) => iframe.current?.contentWindow?.postMessage({ source: "sc-editor", ...m }, "*");

  useEffect(() => {
    if (ready) post({ type: "render", body: parts.body, css: parts.css, selected: selectedId, agent: agentRef.current, agentLabel: props.agentLabel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, parts]);

  const agentKey = (props.agentIds ?? []).join(",") + (props.agentLabel ?? "");
  const agentRef = useRef<string[]>([]);
  agentRef.current = props.agentIds ?? [];
  useEffect(() => {
    if (ready) post({ type: "agent", agent: agentRef.current, agentLabel: props.agentLabel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, agentKey]);

  const commentKey = JSON.stringify(props.commentCounts ?? {});
  useEffect(() => {
    if (ready) post({ type: "comments", items: Object.entries(props.commentCounts ?? {}).map(([id, n]) => ({ id, n })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, commentKey, parts]);

  useEffect(() => {
    if (ready) post({ type: "select", id: selectedId, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  useEffect(() => {
    if (ready && props.scrollToSelected) post({ type: "select", id: selectedId, scroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scrollToSelected]);

  useEffect(() => {
    if (ready) post({ type: "zoom", zoom: fit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fit]);

  // Scale the frame down when the stage is narrower than the breakpoint.
  const fitRef = useRef(1);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth - 64;
      const f = Math.min(1, avail / width) * props.zoom;
      fitRef.current = f;
      setFit(f);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, props.zoom]);

  return (
    <div className="stage" ref={stage} onClick={(e) => e.target === e.currentTarget && onEvent({ type: "select", id: null })}>
      <div className="frame-label">
        {props.pageLabel ? `${props.pageLabel} · ` : ""}{width} px{fit < 0.999 ? ` · ${Math.round(fit * 100)}%` : ""}
      </div>
      <div className="stage-inner" style={{ height: height * fit + 112 }}>
        <div className="frame-wrap" style={{ width, transform: `scale(${fit})` }}>
          <iframe ref={iframe} title="Page canvas" srcDoc={shell} style={{ height }} />
        </div>
      </div>
    </div>
  );
}
