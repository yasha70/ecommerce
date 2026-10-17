// On-page panel for the GST portal: shows the calculated TDS / TCS figures for the table on
// screen and recalculates by itself when that table changes (another month, tab or page).
// Runs as a content script on *.gst.gov.in, or is injected by the popup on any other page.
(function(){
  if(window.__gstPanel) return;
  window.__gstPanel = true;

  const PANEL_CSS = `
:host{all:initial;}
.p{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:72vh;display:flex;flex-direction:column;background:#f7f5ef;border:1px solid #dcd8cc;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-family:'Inter',-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#1f2420;}
.p.min{width:auto;max-width:340px;}
.p-head{display:flex;align-items:center;gap:4px;background:#2a4130;color:#fff;padding:8px 8px 8px 12px;border-radius:7px 7px 0 0;}
.p.min .p-head{border-radius:7px;}
.p-title{flex:1;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.p-btn{background:transparent;border:none;color:#cfd9cf;font-size:16px;line-height:1;cursor:pointer;padding:2px 7px;border-radius:4px;}
.p-btn:hover{background:#3c5a44;color:#fff;}
.p-body{overflow:auto;padding:10px;}
.p.min .p-body{display:none;}
.p-actions{display:flex;gap:8px;margin-top:8px;}
.p-actions button{flex:1;border:1px solid #3c5a44;border-radius:5px;padding:8px;font:600 12.5px 'Inter',-apple-system,'Segoe UI',sans-serif;cursor:pointer;background:#3c5a44;color:#fff;}
.p-actions button + button{background:#fff;color:#2a4130;border-color:#dcd8cc;}
.p-foot{font-size:11px;color:#8a8f84;margin-top:8px;line-height:1.4;}
.p-status{font-size:12px;color:#2a4130;margin-top:4px;min-height:14px;}
`;

  let settings = {...GST_DEFAULTS}, capture = {tables:[]}, rows = [], sig = '', timer = 0;
  let dismissed = false, forced = false, minimized = false, host = null, ui = null, okUrl = '';
  const alive = ()=>{ try{ return !!chrome.runtime.id; }catch(err){ return false; } };

  // Pops up by itself only on the credit pages, not on every portal table with a GSTIN column
  // (e.g. GSTR-1 Table 14); the popup's "Show live panel" button skips this check.
  function onCreditPage(){
    if(okUrl===location.href) return true;
    const text = document.title+' '+(document.body ? document.body.innerText : '');
    if(!/tds\s*(and|&)\s*tcs|tcs\s*credit|tds\s*credit|gstr[\s-]*(2a|7|8)\b/i.test(text)) return false;
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
      p.innerHTML = '<div class="p-head"><span class="p-title"></span><button class="p-btn" data-act="min" title="Minimise"></button><button class="p-btn" data-act="close" title="Close">×</button></div><div class="p-body"></div>';
      ui.appendChild(p);
      ui.addEventListener('click', onClick);
    }
    if(!host.isConnected) document.documentElement.appendChild(host);
  }

  function render(){
    const t = gstTotals(rows, settings), {money} = GstCore;
    const brief = [t.hasTcs ? 'TCS net '+money(t.tcsNet) : '', t.hasTds ? 'TDS '+money(t.tdsNet) : ''].filter(Boolean).join(' · ');
    ui.querySelector('.p').classList.toggle('min', minimized);
    ui.querySelector('.p-title').textContent = minimized ? '₹ '+brief : '₹ TDS / TCS — calculated';
    ui.querySelector('[data-act="min"]').textContent = minimized ? '+' : '–';
    ui.querySelector('[data-act="min"]').title = minimized ? 'Expand' : 'Minimise';
    ui.querySelector('.p-body').innerHTML = minimized ? '' : gstSummaryHtml(rows, settings)+
      '<div class="p-actions"><button data-act="copy">Copy results</button><button data-act="send">Match with reports</button></div>'+
      '<div class="p-status"></div><div class="p-foot">Recalculates by itself when the table changes. GST rate '+settings.rate+'% — change it in the ₹ toolbar popup.</div>';
  }

  function refresh(){
    timer = 0;
    if(!alive()){ observer.disconnect(); if(host) host.remove(); return; } // extension reloaded or removed
    capture = captureGstTables();
    rows = gstCalculate(capture, settings);
    const show = rows.length>0 && !dismissed && (forced || onCreditPage());
    const s = show ? JSON.stringify([minimized, settings, rows]) : '';
    if(show && host && !host.isConnected) sig = ''; // the page threw the panel away; put it back
    if(s===sig) return;
    sig = s;
    if(!show){ if(host) host.style.display = 'none'; return; }
    ensurePanel();
    host.style.display = '';
    render();
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
  function setStatus(text){ const el = ui.querySelector('.p-status'); if(el) el.textContent = text; }

  async function onClick(e){
    const btn = e.target.closest && e.target.closest('[data-act]');
    const act = btn && btn.getAttribute('data-act');
    if(act==='close'){ dismissed = true; sig = ''; host.style.display = 'none'; }
    else if(act==='min'){ minimized = !minimized; sig = 'x'; refresh(); }
    else if(act==='copy') setStatus(await copyText(gstSummaryText(rows, settings)) ? 'Copied — paste into Excel or Google Sheets.' : 'Could not copy.');
    else if(act==='send' && alive()){
      // Same hand-over as the popup: the calculator picks up every "cap:" entry.
      const at = Date.now();
      await chrome.storage.local.set({['cap:'+at]: {at, title:document.title, fy:capture.fy, month:capture.month, tables:capture.tables}});
      chrome.runtime.sendMessage({type:'gst-open-calculator'});
      setStatus('Opened in the calculator — add your marketplace reports there.');
    }
  }

  // Throttled: at most one recalculation every 300 ms while the page is changing.
  const observer = new MutationObserver(()=>{ if(!timer) timer = setTimeout(refresh, 300); });
  observer.observe(document.documentElement, {childList:true, subtree:true, characterData:true});

  chrome.runtime.onMessage.addListener((msg, sender, reply)=>{
    if(!msg || msg.type!=='gst-panel-show') return;
    dismissed = false; forced = true; minimized = false; sig = 'x';
    refresh();
    reply({shown:rows.length>0});
  });
  chrome.storage.local.get('gstSettings', v=>{ settings = {...GST_DEFAULTS, ...((v && v.gstSettings)||{})}; refresh(); });
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area==='local' && changes.gstSettings){ settings = {...GST_DEFAULTS, ...(changes.gstSettings.newValue||{})}; refresh(); }
  });
})();
