// Runs in the GST portal page (content script, or injected by popup.js). Returns every visible
// table that has a GSTIN column, as a grid of cell text, plus the financial year and month
// picked in the page's dropdowns. captureGstTables('next') / ('first') instead clicks the
// table's next-page / first-page control and returns whether it did.
// Self-contained on purpose: the popup passes this function itself to scripting.executeScript.
function captureGstTables(action){
  // The table's own page controls (Bootstrap / dirPagination / DataTables pagers) — never a
  // wizard's NEXT / PROCEED button, which is not inside a pagination container.
  function pageControl(kind){
    const pagers = Array.from(document.querySelectorAll('.pagination, .dataTables_paginate, dir-pagination-controls, [class*="pagination"], nav[aria-label*="agination"]'))
      .filter(p=>p.getClientRects().length);
    for(const p of pagers){
      const items = Array.from(p.querySelectorAll('a, button'));
      const text = el=>el.textContent.replace(/\s+/g,' ').trim();
      const label = el=>(text(el)+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).toLowerCase();
      // "›" is next when the pager also has "«/»" for first/last; a bare "»" is next otherwise.
      const arrows = items.some(el=>/^[‹›]$/.test(text(el)));
      const pick = kind==='first'
        ? items.find(el=>/\bfirst\b/.test(label(el))) || items.find(el=>text(el)==='1') || (arrows && items.find(el=>text(el)==='«'))
        : items.find(el=>/\bnext\b/.test(label(el))) || items.find(el=>/^[›>]$/.test(text(el))) || (!arrows && items.find(el=>text(el)==='»'));
      if(!pick) continue;
      // Judge only the control's own page item: the whole pager often sits in an ".active" tab pane.
      const item = pick.closest('li') || pick, cls = ' '+item.className+' '+pick.className+' ';
      const off = pick.disabled || pick.getAttribute('aria-disabled')==='true' || / disabled /.test(cls) ||
        (kind==='first' && (/ (active|current) /.test(cls) || item.hasAttribute('aria-current') || pick.hasAttribute('aria-current')));
      return off ? null : pick;
    }
    return null;
  }
  if(action){ const el = pageControl(action); if(el) el.click(); return !!el; }

  const isAmount = s=>/^\(?-?[₹\s]*[\d,]+(\.\d+)?\)?$/.test(s);
  const tables = [];
  document.querySelectorAll('table').forEach(t=>{
    if(!t.getClientRects().length || t.querySelector('table')) return; // hidden tab, or a layout table
    const grid = [];
    Array.from(t.rows).forEach((tr,ri)=>{
      const row = grid[ri] = grid[ri]||[];
      let ci = 0;
      Array.from(tr.cells).forEach(td=>{
        while(row[ci]!==undefined) ci++;
        const text = td.innerText.replace(/\s+/g,' ').trim();
        const rs = Math.max(1, td.rowSpan||1), cs = Math.max(1, td.colSpan||1);
        for(let r=0;r<rs;r++){
          const target = grid[ri+r] = grid[ri+r]||[];
          // A GSTIN / name spanning several rows (e.g. state-wise lines) is repeated on each of them;
          // an amount spanning rows is kept once so it is never counted twice.
          for(let c=0;c<cs;c++) target[ci+c] = c===0 && (r===0 || !isAmount(text)) ? text : '';
        }
        ci += cs;
      });
    });
    const rows = grid.map(r=>Array.from(r, c=>c??''));
    if(rows.length>=2 && rows.slice(0,5).some(r=>r.some(c=>/gstin/i.test(c)))) tables.push(rows);
  });

  // Signature of what is on screen, so the month picked in the dropdowns is only taken when the
  // table itself changes: changing a dropdown without pressing Search keeps the old label.
  const json = JSON.stringify(tables);
  let h = 5381;
  for(let i=0;i<json.length;i++) h = (h*33 + json.charCodeAt(i)) | 0;
  const sig = tables.length ? 'p'+(h>>>0).toString(36)+json.length.toString(36) : '';
  const prev = window.__gstHint;
  if(!prev || prev.sig!==sig){
    const picked = Array.from(document.querySelectorAll('select')).map(s=>s.selectedIndex>=0 ? s.options[s.selectedIndex].text.trim() : '');
    window.__gstHint = {
      sig,
      fy: (picked.join(' ').match(/20\d\d\s*-\s*\d{2,4}/)||[''])[0],
      month: picked.find(t=>/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-]*(20\d\d|\d\d)?$/i.test(t))||'',
    };
  }
  // hasPages: the table is split into pages (a next page ahead, or earlier pages behind).
  return {tables, sig, fy:window.__gstHint.fy, month:window.__gstHint.month, hasPages:!!(pageControl('next') || pageControl('first'))};
}
