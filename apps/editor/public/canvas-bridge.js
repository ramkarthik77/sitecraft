// Runs inside the editor canvas iframe: selection, inline text editing, drag and drop.
// Loaded as a file (not inline) so the editor can use a strict Content-Security-Policy.
(function(){
  var sel=null, editing=null;
  var root=document.getElementById('sc-root'), css=document.getElementById('sc-css');
  function post(m){parent.postMessage(Object.assign({source:'sc-canvas'},m),'*')}
  function nodeOf(t){return t&&t.closest?t.closest('[data-node-id]'):null}
  var agent=[], comments=[], agentLabel='Claude', zoom=1, overlay=document.getElementById('sc-overlay');
  var TYPE={heading:'H',text:'Text',image:'Image',button:'Button',link:'Link',section:'Section',stack:'Stack',grid:'Grid',form:'Form',input:'Field',embed:'Embed',divider:'Divider',spacer:'Spacer',richtext:'Rich text','collection-list':'List','language-switch':'Languages'};
  function tag(cls,txt,x,y){var d=document.createElement('span');d.className=cls;d.textContent=txt;d.style.left=x+'px';d.style.top=y+'px';if(zoom<1){d.style.transform='scale('+(1/zoom)+')'}overlay.appendChild(d)}
  function mark(){
    document.querySelectorAll('.sc-sel').forEach(function(e){e.classList.remove('sc-sel')});
    document.querySelectorAll('.sc-agent').forEach(function(e){e.classList.remove('sc-agent')});
    overlay.textContent='';
    agent.forEach(function(id){var a=document.querySelector('[data-node-id="'+CSS.escape(id)+'"]'); if(!a)return; a.classList.add('sc-agent');
      var r=a.getBoundingClientRect(); tag('sc-tag sc-tag-agent',agentLabel,r.left+scrollX+6,Math.max(0,r.top+scrollY+6))});
    comments.forEach(function(c){var a=document.querySelector('[data-node-id="'+CSS.escape(c.id)+'"]'); if(!a)return;
      var r=a.getBoundingClientRect(); tag('sc-tag sc-tag-comment',String(c.n),Math.max(0,r.right+scrollX-22),Math.max(0,r.top+scrollY+4))});
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
    if(d.type==='comments'){ comments=d.items||[]; mark(); }
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
    if(['heading','text','button'].indexOf(t)<0||n.getAttribute('data-bound'))return;
    e.preventDefault(); editing=n; var before=n.innerText; n.contentEditable='plaintext-only'; if(n.contentEditable!=='plaintext-only')n.contentEditable='true';
    overlay.textContent=''; n.focus(); var r=document.createRange(); r.selectNodeContents(n); var s=getSelection(); s.removeAllRanges(); s.addRange(r);
    function done(commit){ n.removeEventListener('blur',onBlur); n.removeEventListener('keydown',onKey); n.contentEditable='false'; editing=null;
      var txt=n.innerText.replace(/\n+$/,''); if(commit&&txt!==before)post({type:'text',id:n.getAttribute('data-node-id'),text:txt}); else n.innerText=before; mark(); }
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
})();
