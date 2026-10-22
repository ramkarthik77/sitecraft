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
const BRIDGE = `
(function(){
  var sel=null, editing=null;
  var root=document.getElementById('sc-root'), css=document.getElementById('sc-css');
  function post(m){parent.postMessage(Object.assign({source:'sc-canvas'},m),'*')}
  function nodeOf(t){return t&&t.closest?t.closest('[data-node-id]'):null}
  var agent=[], agentLabel='Claude', zoom=1, overlay=document.getElementById('sc-overlay');
  var TYPE={heading:'H',text:'Text',image:'Image',button:'Button',link:'Link',section:'Section',stack:'Stack',grid:'Grid',form:'Form',input:'Field',embed:'Embed',divider:'Divider',spacer:'Spacer'};
  function tag(cls,txt,x,y){var d=document.createElement('span');d.className=cls;d.textContent=txt;d.style.left=x+'px';d.style.top=y+'px';if(zoom<1){d.style.transform='scale('+(1/zoom)+')'}overlay.appendChild(d)}
  function mark(){
    document.querySelectorAll('.sc-sel').forEach(function(e){e.classList.remove('sc-sel')});
    document.querySelectorAll('.sc-agent').forEach(function(e){e.classList.remove('sc-agent')});
    overlay.textContent='';
    agent.forEach(function(id){var a=document.querySelector('[data-node-id="'+CSS.escape(id)+'"]'); if(!a)return; a.classList.add('sc-agent');
      var r=a.getBoundingClientRect(); tag('sc-tag sc-tag-agent',agentLabel,r.left+scrollX+6,Math.max(0,r.top+scrollY+6))});
    if(sel){var el=document.querySelector('[data-node-id="'+CSS.escape(sel)+'"]'); if(el){el.classList.add('sc-sel');
      var r=el.getBoundingClientRect(), t=el.getAttribute('data-node-type'), name=TYPE[t]||t;
      if(t==='heading'){name='H'+(el.tagName.slice(1)||'')}
      var y=r.top+scrollY-20/zoom; tag('sc-tag sc-tag-sel',name+' · '+Math.round(r.width)+' × '+Math.round(r.height),r.left+scrollX,y<2?r.top+scrollY+2:y)}}
  }
  window.addEventListener('resize',function(){mark()});
  function height(){post({type:'height',h:Math.max(document.documentElement.scrollHeight, 200)})}
  window.addEventListener('message',function(e){
    var d=e.data||{}; if(d.source!=='sc-editor')return;
    if(d.type==='render'){ if(editing)return; css.textContent=d.css; root.innerHTML=d.body; sel=d.selected; agent=d.agent||[]; agentLabel=d.agentLabel||'Claude'; mark(); setTimeout(function(){height();mark()},0); [].slice.call(document.images).forEach(function(i){if(!i.complete)i.addEventListener('load',function(){mark()},{once:true})}); }
    if(d.type==='agent'){ agent=d.agent||[]; agentLabel=d.agentLabel||'Claude'; mark(); }
    if(d.type==='zoom'){ zoom=d.zoom||1; mark(); }
    if(d.type==='select'){ sel=d.id; mark(); if(d.scroll){var el=document.querySelector('[data-node-id="'+CSS.escape(sel)+'"]'); if(el){var r=el.getBoundingClientRect(); post({type:'scrollTo', y:r.top+scrollY})}} }
  });
  document.addEventListener('click',function(e){
    if(editing&&editing.contains(e.target))return;
    e.preventDefault(); var n=nodeOf(e.target); post({type:'select',id:n?n.getAttribute('data-node-id'):null});
  },true);
  document.addEventListener('submit',function(e){e.preventDefault()},true);
  document.addEventListener('mouseover',function(e){
    document.querySelectorAll('.sc-hov').forEach(function(x){x.classList.remove('sc-hov')});
    var n=nodeOf(e.target); if(n)n.classList.add('sc-hov');
  });
  document.addEventListener('mouseleave',function(){document.querySelectorAll('.sc-hov').forEach(function(x){x.classList.remove('sc-hov')})});
  document.addEventListener('dblclick',function(e){
    var n=nodeOf(e.target); if(!n)return; var t=n.getAttribute('data-node-type');
    if(['heading','text','button'].indexOf(t)<0)return;
    e.preventDefault(); editing=n; var before=n.innerText; n.contentEditable='plaintext-only'; if(n.contentEditable!=='plaintext-only')n.contentEditable='true';
    overlay.textContent=''; n.focus(); var r=document.createRange(); r.selectNodeContents(n); var s=getSelection(); s.removeAllRanges(); s.addRange(r);
    function done(commit){ n.removeEventListener('blur',onBlur); n.removeEventListener('keydown',onKey); n.contentEditable='false'; editing=null;
      var txt=n.innerText.replace(/\\n+$/,''); if(commit&&txt!==before)post({type:'text',id:n.getAttribute('data-node-id'),text:txt}); else n.innerText=before; mark(); }
    function onBlur(){done(true)}
    function onKey(k){ if(k.key==='Enter'&&!k.shiftKey){k.preventDefault();n.blur()} if(k.key==='Escape'){k.preventDefault();done(false)} k.stopPropagation(); }
    n.addEventListener('blur',onBlur); n.addEventListener('keydown',onKey);
  });
  document.addEventListener('keydown',function(e){
    if(editing)return;
    if(['Delete','Backspace','Escape','d','z','y','ArrowUp','ArrowDown'].indexOf(e.key)>=0){ if(e.key!=='Delete'&&e.key!=='Backspace'&&e.key!=='Escape'&&e.key.indexOf('Arrow')<0&&!(e.metaKey||e.ctrlKey))return; e.preventDefault(); post({type:'key',key:e.key,meta:e.metaKey||e.ctrlKey,shift:e.shiftKey}); }
  });
  var dropEl=null;
  function clearDrop(){ if(dropEl){dropEl.classList.remove('sc-drop-before','sc-drop-after','sc-drop-in'); dropEl=null} }
  document.addEventListener('dragover',function(e){ e.preventDefault(); var n=nodeOf(e.target); clearDrop(); if(!n)return; dropEl=n;
    var r=n.getBoundingClientRect(); n.classList.add(e.clientY<r.top+r.height/2?'sc-drop-before':'sc-drop-after'); });
  document.addEventListener('dragleave',function(e){ if(!e.relatedTarget)clearDrop() });
  document.addEventListener('drop',function(e){ e.preventDefault(); var n=nodeOf(e.target); var before=false;
    if(n){var r=n.getBoundingClientRect(); before=e.clientY<r.top+r.height/2}
    clearDrop(); post({type:'drop',id:n?n.getAttribute('data-node-id'):null,payload:e.dataTransfer.getData('text/plain'),before:before}); });
  new ResizeObserver(height).observe(document.body);
  post({type:'ready'});
})();`;

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

  const parts = useMemo(() => renderPageParts(doc, page, { mode: "editor" }), [doc, page]);

  const shell = useMemo(
    () =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500&family=Geist+Mono:wght@500&display=swap">` +
      `<style id="sc-css"></style><style>${UI_CSS}</style></head><body><div id="sc-root"></div><div id="sc-overlay"></div><script>${BRIDGE}</script></body></html>`,
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
