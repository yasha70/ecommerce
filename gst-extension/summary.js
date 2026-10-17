// Shared by the popup and the on-page panel: turns the tables on screen into the calculated
// TDS / TCS summary. GstCore (built from index.html) does the maths, as on the dashboard.
// `var` and function declarations only, so injecting this file twice into a page is harmless.
var GST_DEFAULTS = {rate:5, tol:10};

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
`;

function gstEsc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// capture: {tables, fy, month} as returned by captureGstTables()
function gstCalculate(capture, settings){
  const month = GstCore.toPeriod(capture.month, GstCore.fyStart(capture.fy)) || '';
  const recs = [];
  (capture.tables||[]).forEach(t=>{
    const p = GstCore.readPortal(t, '', '');
    if(p) p.rows.forEach(r=>recs.push({...r, period:r.period||month}));
  });
  return GstCore.summarizePortal(recs, settings.tol);
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
  const lines = rows.map(r=>{
    const ok = r.check==='OK';
    const value = r.gross!=null ? `Gross ${money(r.gross)} − returned ${money(r.returned||0)} = <b>net ${money(r.net)}</b>` : `Taxable value <b>${money(r.net)}</b>`;
    const split = r.inter==null ? '' : `<div>Inter-state ${money(r.inter)} · Intra-state ${money(r.intra)}</div>`;
    return `<div class="g-row">
      <div class="g-row-head"><span class="g-type">${r.type}</span>${gstEsc(r.name||r.gstin||'—')} · ${periodLabel(r.period)}<span class="g-check ${ok?'g-ok':'g-bad'}">${ok ? '✓ '+pct(r.effRate) : '! '+gstEsc(r.check)}</span></div>
      <div>${value}</div>
      <div>Credit <b>${money(r.tax)}</b> (IGST ${money(r.igst)} · CGST ${money(r.cgst)} · SGST ${money(r.sgst)})</div>${split}
    </div>`;
  }).join('');
  return `<div class="g-cards">${cards.join('')}</div>${lines}`;
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
