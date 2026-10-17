// On-page panel for the GST portal: shows the calculated TDS / TCS figures for the table on
// screen, recalculates by itself when that table changes, and adds up every page and month
// viewed ("All collected"). Runs as a content script on *.gst.gov.in, or is injected by the
// popup on any other page.
(function(){
  if(window.__gstPanel) return;
  window.__gstPanel = true;
  const old = document.getElementById('gst-tds-tcs-panel');
  if(old) old.remove(); // left behind by the copy that ran before the extension was updated

  const PANEL_CSS = `
:host{all:initial;}
.p{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:72vh;display:flex;flex-direction:column;background:#f7f5ef;border:1px solid #dcd8cc;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#1f2420;}
.p.min{width:auto;max-width:340px;}
.p.left{right:auto;left:16px;}
.p-head{display:flex;align-items:center;gap:4px;background:#2a4130;color:#fff;padding:8px 8px 8px 12px;border-radius:7px 7px 0 0;}
.p.min .p-head{border-radius:7px;}
.p-title{flex:1;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.p-btn{background:transparent;border:none;color:#cfd9cf;font-size:16px;line-height:1;cursor:pointer;padding:2px 7px;border-radius:4px;}
.p-btn:hover{background:#3c5a44;color:#fff;}
.p-body{overflow:auto;padding:10px;}
.p.min .p-body{display:none;}
.p-views{display:flex;border:1px solid #dcd8cc;border-radius:6px;overflow:hidden;margin-bottom:8px;}
.p-views button{flex:1;border:none;background:#eeece3;color:#5a5f57;padding:6px 4px;font:600 12px 'Inter',-apple-system,'Segoe UI',sans-serif;cursor:pointer;}
.p-views button.on{background:#fff;color:#2a4130;}
.p-info{font-size:11.5px;color:#5a5f57;margin:0 0 8px;line-height:1.4;}
.p-link{background:none;border:none;padding:0;color:#2a4130;text-decoration:underline;cursor:pointer;font:inherit;}
.p-actions{display:flex;gap:8px;margin-top:8px;}
.p-actions button{flex:1;border:1px solid #3c5a44;border-radius:5px;padding:8px;font:600 12.5px 'Inter',-apple-system,'Segoe UI',sans-serif;cursor:pointer;background:#3c5a44;color:#fff;}
.p-actions button + button{background:#fff;color:#2a4130;border-color:#dcd8cc;}
.p-actions button:disabled{opacity:.5;cursor:default;}
.p-foot{font-size:11px;color:#8a8f84;margin-top:8px;line-height:1.4;}
.p-status{font-size:12px;color:#2a4130;margin-top:4px;min-height:14px;}
`;

  let settings = {...GST_DEFAULTS}, capture = {tables:[]}, pageRecs = [], sig = '', timer = 0;
  let pages = {}, pagesVer = 0, addedSig = ''; // collected pages (all tabs), and the page this frame last offered
  let dismissed = false, forced = false, minimized = false, view = 'page', busy = false, host = null, ui = null, okUrl = '', statusText = '';
  let prefs = {min:false, left:false}; // remembered: start minimised / on the left, so the portal's buttons stay reachable
  const alive = ()=>{ try{ return !!chrome.runtime.id; }catch(err){ return false; } };

  // Pops up by itself only on the credit pages, not on every portal table with a GSTIN column
  // (e.g. GSTR-1 Table 14); the popup's "Show live panel" button skips this check.
  function onCreditPage(){
    if(okUrl===location.href) return true;
    if(!GST_CREDIT_PAGE.test(document.title+' '+(document.body ? document.body.innerText : ''))) return false;
    okUrl = location.href;
    return true;
  }

  function ensurePanel(){
    if(!host){
      host = document.createElement('div');
      host.id = 'gst-tds-tcs-panel';
      ui = host.attachShadow({mode:'open'});
      const css = PANEL_CSS+GST_SUMMARY_CSS;
      try{ const sheet = new CSSStyleSheet(); sheet.replaceSync(css); ui.adoptedStyleSheets = [sheet]; } // not blocked by the page's CSP
      catch(err){ const st = document.createElement('style'); st.textContent = css; ui.appendChild(st); }
      const p = document.createElement('div');
      p.className = 'p';
      p.innerHTML = '<div class="p-head"><span class="p-title"></span><button class="p-btn" data-act="side" title="Move to the other side">⇄</button><button class="p-btn" data-act="min"></button><button class="p-btn" data-act="close" title="Close (pages are still collected)">×</button></div><div class="p-body"></div>';
      ui.appendChild(p);
      ui.addEventListener('click', onClick);
    }
    if(!host.isConnected) document.documentElement.appendChild(host);
  }

  function shownRows(){
    return GstCore.summarizePortal(view==='all' ? gstCollectedRecords(pages, Date.now()) : pageRecs, settings.tol);
  }

  function render(){
    const rows = shownRows(), t = gstTotals(rows, settings), info = gstCollectionInfo(pages, Date.now()), {money} = GstCore;
    const brief = [t.hasTcs ? 'TCS net '+money(t.tcsNet) : '', t.hasTds ? 'TDS '+money(t.tdsNet) : ''].filter(Boolean).join(' · ');
    ui.querySelector('.p').classList.toggle('min', minimized);
    ui.querySelector('.p').classList.toggle('left', prefs.left);
    ui.querySelector('.p-title').textContent = minimized ? '₹ '+(view==='all' ? 'All: ' : '')+brief : '₹ TDS / TCS — calculated';
    const min = ui.querySelector('[data-act="min"]');
    min.textContent = minimized ? '+' : '–';
    min.title = minimized ? 'Expand' : 'Minimise';
    if(minimized){ ui.querySelector('.p-body').innerHTML = ''; return; }
    const views = `<div class="p-views"><button data-act="view-page" class="${view==='page'?'on':''}">This page</button><button data-act="view-all" class="${view==='all'?'on':''}">All collected${info.pages ? ' · '+info.pages+' page'+(info.pages>1?'s':'') : ''}</button></div>`;
    const about = view==='all'
      ? (info.rows ? `<p class="p-info">${info.rows} row${info.rows>1?'s':''} from ${info.pages} page${info.pages>1?'s':''}${info.months ? ' · '+info.months : ''} · since ${info.since}. Every page and month you open is added once. <button class="p-link" data-act="clear">Clear</button></p>` : '<p class="p-info">Nothing collected yet — open the pages or months you need, or use Read all pages.</p>')
      : (info.pages>1 ? `<p class="p-info">You have opened ${info.pages} pages — see the combined total under <button class="p-link" data-act="view-all">All collected</button>.</p>` : '');
    const pager = capture.hasPages || busy ? `<div class="p-actions"><button data-act="read-all"${busy?' disabled':''}>${busy ? 'Reading pages…' : 'Read all pages'}</button></div>` : '';
    ui.querySelector('.p-body').innerHTML = views+about+(rows.length ? gstSummaryHtml(rows, settings) : '')+pager+
      `<div class="p-actions"><button data-act="copy"${rows.length?'':' disabled'}>Copy results</button><button data-act="send"${rows.length?'':' disabled'}>Match with reports</button></div>`+
      '<div class="p-status">'+gstEsc(statusText)+'</div><div class="p-foot">Recalculates by itself when the table changes. GST rate '+settings.rate+'% — change it in the ₹ toolbar popup.</div>';
  }

  function refresh(){
    timer = 0;
    if(!alive()){ observer.disconnect(); if(host) host.remove(); return; } // extension reloaded or removed
    capture = captureGstTables();
    pageRecs = gstRecords(capture);
    const eligible = pageRecs.length>0 && (forced || onCreditPage()), show = eligible && !dismissed;
    if(eligible && capture.sig!==addedSig){ // collected when it appears here (also with the panel closed), not on every redraw
      addedSig = capture.sig;
      if(gstSavePage(pages, capture.sig, pageRecs, Date.now())) pagesVer++;
    }
    const s = show || (host && host.style.display!=='none' && busy) ? JSON.stringify([minimized, prefs.left, view, busy, settings, capture.sig, capture.hasPages, pagesVer]) : '';
    if(show && host && !host.isConnected) sig = ''; // the page threw the panel away; put it back
    if(s===sig) return;
    sig = s;
    if(!s){ if(host) host.style.display = 'none'; return; }
    ensurePanel();
    host.style.display = '';
    render();
  }

  // Signature of the table on screen, but only once it holds credit rows: while the next page
  // loads the portal may keep the header with a "Loading…" / "No records" row, which must not count.
  function creditSig(){ const c = captureGstTables(); return gstRecords(c).length ? c.sig : ''; }
  // After clicking a page control: wait until different credit rows have settled. False if nothing changed in 8 s.
  async function pageTurned(before){
    const sleep = ms=>new Promise(r=>setTimeout(r, ms));
    for(const t0 = Date.now(); Date.now()-t0<8000; await sleep(150)){
      const now = creditSig();
      if(now && now!==before){ await sleep(200); if(creditSig()===now) return true; }
    }
    return false;
  }
  // Goes to the first page, then clicks through every page, collecting each, and shows the total.
  async function readAllPages(){
    if(busy) return;
    busy = true; view = 'all'; setStatus('Reading page 1…');
    addedSig = ''; // collect the page on screen too, even if it was dropped by a Clear elsewhere
    sig = 'x'; refresh();
    let before = creditSig();
    if(captureGstTables('first') && await pageTurned(before)){ sig = 'x'; refresh(); }
    let pages = 1;
    for(; pages<60; pages++){
      before = creditSig();
      if(!captureGstTables('next') || !await pageTurned(before)) break; // last page, or it did not move
      setStatus('Reading page '+(pages+1)+'…');
      sig = 'x'; refresh();
    }
    busy = false;
    setStatus('Read '+pages+' page'+(pages>1?'s':'')+' — the total is under All collected.');
    sig = 'x'; refresh();
  }

  async function copyText(text){
    try{ await navigator.clipboard.writeText(text); return true; }
    catch(err){
      const ta = document.createElement('textarea');
      ta.value = text; ui.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }
  function setStatus(text){ statusText = text; const el = ui && ui.querySelector('.p-status'); if(el) el.textContent = text; }

  async function onClick(e){
    const btn = e.target.closest && e.target.closest('[data-act]');
    const act = btn && btn.getAttribute('data-act');
    if(!act) return;
    if(!alive()){ setStatus('The extension was updated — reload this page to use the panel.'); return; }
    if(act==='close'){ dismissed = true; sig = ''; host.style.display = 'none'; }
    else if(act==='min'){ minimized = prefs.min = !minimized; chrome.storage.local.set({gstPanelPrefs:prefs}); sig = 'x'; refresh(); }
    else if(act==='side'){ prefs = {...prefs, left:!prefs.left}; chrome.storage.local.set({gstPanelPrefs:prefs}); sig = 'x'; refresh(); }
    else if(act==='view-page' || act==='view-all'){ view = act==='view-all' ? 'all' : 'page'; statusText = ''; sig = 'x'; refresh(); }
    else if(act==='clear'){ // start again from the page on screen
      await gstClearPages(pages, capture.sig, pageRecs, Date.now());
      statusText = ''; pagesVer++; sig = 'x'; refresh();
    }
    else if(act==='read-all') readAllPages();
    else if(act==='copy') setStatus(await copyText(gstSummaryText(shownRows(), settings)) ? 'Copied — paste into Excel or Google Sheets.' : 'Could not copy.');
    else if(act==='send'){
      // Same hand-over as the popup: the calculator picks up every "cap:" entry.
      const at = Date.now();
      const entry = view==='all'
        ? {at, title:'All collected', fy:'', month:'', tables:gstRecordsToTables(gstCollectedRecords(pages, at))}
        : {at, title:document.title, fy:capture.fy, month:capture.month, tables:capture.tables};
      await chrome.storage.local.set({['cap:'+at]: entry});
      chrome.runtime.sendMessage({type:'gst-open-calculator'});
      setStatus('Opened in the calculator — add your marketplace reports there.');
    }
  }

  // Throttled: at most one recalculation every 300 ms while the page is changing. Class / style
  // changes count too: TCS / TDS tabs and ng-show switch by toggling them.
  const observer = new MutationObserver(()=>{ if(!timer) timer = setTimeout(refresh, 300); });
  observer.observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','style','hidden']});

  chrome.runtime.onMessage.addListener((msg, sender, reply)=>{
    if(!msg) return;
    if(msg.type==='gst-panel-show' || msg.type==='gst-read-all'){
      dismissed = false; forced = true; minimized = false; sig = 'x';
      refresh();
      if(msg.type==='gst-read-all' && pageRecs.length) readAllPages();
      reply({shown:pageRecs.length>0});
    }
  });
  chrome.storage.local.get(null, v=>{
    settings = {...GST_DEFAULTS, ...((v && v.gstSettings)||{})};
    pages = gstPagesFrom(v);
    prefs = {...prefs, ...((v && v.gstPanelPrefs)||{})};
    minimized = !!prefs.min;
    refresh();
  });
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area!=='local') return;
    const pageKeys = Object.keys(changes).filter(k=>k.startsWith(GST_PAGE_KEY));
    if(!changes.gstSettings && !pageKeys.length) return;
    if(changes.gstSettings) settings = {...GST_DEFAULTS, ...(changes.gstSettings.newValue||{})};
    pageKeys.forEach(k=>{ // pages saved or cleared by another tab, frame or the popup
      const s = k.slice(GST_PAGE_KEY.length), v = changes[k].newValue;
      if(v) pages[s] = v; else delete pages[s];
    });
    if(pageKeys.length) pagesVer++;
    sig = 'x'; refresh();
  });
})();
