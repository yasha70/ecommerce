// Shared by the popup and the on-page panel: turns the tables on screen into the calculated
// TDS / TCS summary. GstCore (built from index.html) does the maths, as on the dashboard.
// `var` and function declarations only, so injecting this file twice into a page is harmless.
var GST_DEFAULTS = {rate:5, tol:10};
var GST_COLLECTION_TTL = 12*3600e3; // a collection untouched for 12 hours starts afresh

var GST_SUMMARY_CSS = `
.g-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
.g-card{background:#fff;border:1px solid #dcd8cc;border-radius:6px;padding:8px 10px;}
.g-label{font-size:11px;color:#7a7f76;margin-bottom:3px;}
.g-value{font-family:'Source Serif Pro',Georgia,serif;font-size:17px;font-weight:600;color:#1f2420;}
.g-strong .g-value{color:#2a4130;}
.g-row{background:#fff;border:1px solid #dcd8cc;border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;color:#3a3f38;line-height:1.5;}
.g-row b{color:#1f2420;}
.g-row-head{font-weight:600;color:#1f2420;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:2px;}
.g-type{font-family:'IBM Plex Mono','SF Mono',monospace;font-size:10.5px;background:#eef2ec;color:#2a4130;border-radius:8px;padding:1px 6px;}
.g-check{margin-left:auto;font-size:11px;font-weight:600;}
.g-ok{color:#2a4130;}
.g-bad{color:#a6432f;}
.g-muted{color:#8a8f84;}
.g-warn{background:#fbf3e1;border:1px solid #e6cf9a;color:#7a5a12;border-radius:6px;padding:6px 9px;font-size:11.5px;margin-bottom:8px;}
`;

function gstEsc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// capture: {tables, fy, month} as returned by captureGstTables(). One record per credit row,
// with the month from the row itself or else from the page's dropdowns.
function gstRecords(capture){
  const fy = GstCore.fyStart(capture.fy), month = GstCore.toPeriod(capture.month, fy) || '';
  const recs = [], seen = {};
  (capture.tables||[]).forEach(t=>{
    const p = GstCore.readPortal(t, '', '', fy);
    if(p) p.rows.forEach(r=>{
      // A credit is known by its operator and amounts, so the same credit seen on another page or
      // screen (credit page, GSTR-2A, a saved copy) is counted once; identical rows on one page
      // are numbered so both count.
      const k = [r.gstin, r.gross, r.returned, r.net, r.igst, r.cgst, r.sgst].join('|');
      const n = seen[k] = (seen[k]||0)+1;
      recs.push({...r, period:r.period||month, key:k+'#'+n});
    });
  });
  return recs;
}
function gstCalculate(capture, settings){ return GstCore.summarizePortal(gstRecords(capture), settings.tol); }

// ---------- Collecting several pages / months ----------
// coll: {since, updated, pages:{sig:1}, recs:{key:record}}. A page (table signature) is added once,
// and a credit seen again (same type, month, operator and amounts) replaces itself, so nothing is
// counted twice. Returns the new collection, or null when nothing changed.
function gstAddToCollection(coll, recs, sig, now){
  if(!sig || !recs.length) return null;
  const fresh = !coll || now-coll.updated>GST_COLLECTION_TTL;
  if(!fresh && coll.pages[sig]) return null;
  const c = fresh ? {since:now, updated:now, pages:{}, recs:{}} : {...coll, pages:{...coll.pages}, recs:{...coll.recs}};
  c.updated = now; c.pages[sig] = 1;
  recs.forEach(r=>{ c.recs[r.type+'|'+r.period+'|'+r.key] = r; });
  return c;
}
function gstCollectedRecords(coll, now){ return coll && now-coll.updated<=GST_COLLECTION_TTL ? Object.values(coll.recs) : []; }
function gstCollectionInfo(coll, now){
  const recs = gstCollectedRecords(coll, now);
  if(!recs.length) return {rows:0, pages:0, months:'', since:''};
  const months = [...new Set(recs.map(r=>r.period).filter(Boolean))].sort().map(GstCore.periodLabel);
  return {
    rows:recs.length, pages:Object.keys(coll.pages).length,
    months: months.length>2 ? months[0]+' – '+months[months.length-1]+' ('+months.length+' months)' : months.join(', '),
    since: new Date(coll.since).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}),
  };
}
// Collected rows as portal-style tables, so the full calculator can read them like a capture.
function gstRecordsToTables(recs){
  return ['TCS','TDS'].map(type=>{
    const rs = recs.filter(r=>r.type===type);
    if(!rs.length) return null;
    const withGross = type==='TCS' && rs.every(r=>r.gross!=null && r.returned!=null);
    const head = type==='TCS'
      ? ['GSTIN of e-commerce operator','Trade name','Tax period', ...(withGross ? ['Gross value of supplies','Value of supplies returned'] : []), 'Net amount liable for TCS','Integrated tax','Central tax','State/UT tax']
      : ['GSTIN of deductor','Deductor name','Tax period','Taxable value','Integrated tax','Central tax','State/UT tax'];
    return [head, ...rs.map(r=>[r.gstin, r.name, r.period, ...(withGross ? [r.gross, r.returned] : []), r.net, r.igst, r.cgst, r.sgst])];
  }).filter(Boolean);
}

function gstTotals(rows, settings){
  const sum = (k, type)=>rows.reduce((s,r)=>s+(!type || r.type===type ? r[k]||0 : 0), 0);
  const rate = settings.rate/100, inter = sum('inter'), intra = sum('intra');
  return {
    tcsNet:sum('net','TCS'), tcsTax:sum('tax','TCS'), tdsNet:sum('net','TDS'), tdsTax:sum('tax','TDS'),
    hasTcs:rows.some(r=>r.type==='TCS'), hasTds:rows.some(r=>r.type==='TDS'),
    inter, intra, igst:inter*rate, cgst:intra*rate/2,
  };
}

function gstSummaryHtml(rows, settings){
  const {money, pct, periodLabel} = GstCore, t = gstTotals(rows, settings);
  const card = (label, value, cls)=>`<div class="g-card ${cls||''}"><div class="g-label">${label}</div><div class="g-value">${value}</div></div>`;
  const cards = [];
  if(t.hasTcs) cards.push(card('TCS taxable value (net)', money(t.tcsNet), 'g-strong'), card('TCS credit', money(t.tcsTax)));
  if(t.hasTds) cards.push(card('TDS taxable value', money(t.tdsNet), 'g-strong'), card('TDS credit', money(t.tdsTax)));
  cards.push(card('Inter-state taxable', money(t.inter)), card('Intra-state taxable', money(t.intra)),
    card('Est. IGST @ '+settings.rate+'%', money(t.igst)), card('Est. CGST &amp; SGST (each)', money(t.cgst)));
  const noMonth = rows.some(r=>!r.period);
  const lines = rows.map(r=>{
    const ok = r.check==='OK', unchecked = ok && r.type==='TCS' && !r.period; // TCS rate depends on the month
    const value = r.gross!=null ? `Gross ${money(r.gross)} − returned ${money(r.returned||0)} = <b>net ${money(r.net)}</b>` : `Taxable value <b>${money(r.net)}</b>`;
    const split = r.inter==null ? '' : `<div>Inter-state ${money(r.inter)} · Intra-state ${money(r.intra)}</div>`;
    return `<div class="g-row">
      <div class="g-row-head"><span class="g-type">${r.type}</span>${gstEsc(r.name||r.gstin||'—')} · ${periodLabel(r.period)}<span class="g-check ${unchecked?'g-muted':ok?'g-ok':'g-bad'}">${unchecked ? pct(r.effRate)+' · rate not checked' : ok ? '✓ '+pct(r.effRate) : '! '+gstEsc(r.check)}</span></div>
      <div>${value}</div>
      <div>Credit <b>${money(r.tax)}</b> (IGST ${money(r.igst)} · CGST ${money(r.cgst)} · SGST ${money(r.sgst)})</div>${split}
    </div>`;
  }).join('');
  const warn = noMonth ? '<div class="g-warn">The month could not be read for some rows ("No month"), so their TCS rate was not checked. Pick the financial year and period on the page and search again.</div>' : '';
  return `${warn}<div class="g-cards">${cards.join('')}</div>${lines}`;
}

// Tab-separated, so it pastes straight into Excel / Google Sheets.
function gstSummaryText(rows, settings){
  const r2 = n=>n==null ? '' : Math.round(n*100)/100, t = gstTotals(rows, settings);
  const out = [['Type','Operator / Deductor','GSTIN','Month','Gross value','Value returned','Net taxable','Inter-state taxable','Intra-state taxable','IGST','CGST','SGST','Credit','Rate %','Check']];
  rows.forEach(r=>out.push([r.type, r.name, r.gstin, GstCore.periodLabel(r.period), r2(r.gross), r2(r.returned), r2(r.net), r2(r.inter), r2(r.intra), r2(r.igst), r2(r.cgst), r2(r.sgst), r2(r.tax), r2(r.effRate*100), r.check]));
  out.push([]);
  if(t.hasTcs) out.push(['TCS taxable value (net)', r2(t.tcsNet)], ['TCS credit', r2(t.tcsTax)]);
  if(t.hasTds) out.push(['TDS taxable value', r2(t.tdsNet)], ['TDS credit', r2(t.tdsTax)]);
  out.push(['Inter-state taxable', r2(t.inter)], ['Intra-state taxable', r2(t.intra)],
    ['Est. IGST @ '+settings.rate+'%', r2(t.igst)], ['Est. CGST @ '+settings.rate/2+'%', r2(t.cgst)], ['Est. SGST @ '+settings.rate/2+'%', r2(t.cgst)]);
  return out.map(r=>r.map(c=>String(c??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n');
}
