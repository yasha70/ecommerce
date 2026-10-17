// Injected into the GST portal tab by popup.js. Returns every visible table that has a
// GSTIN column, as a grid of cell text (row/column spans expanded so merged headers line
// up), plus the financial year and month picked in the page's dropdowns, if any.
function captureGstTables(){
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
          for(let c=0;c<cs;c++) target[ci+c] = r===0 && c===0 ? text : '';
        }
        ci += cs;
      });
    });
    const rows = grid.map(r=>Array.from(r, c=>c??''));
    if(rows.length>=2 && rows.slice(0,5).some(r=>r.some(c=>/gstin/i.test(c)))) tables.push(rows);
  });
  const picked = Array.from(document.querySelectorAll('select')).map(s=>s.selectedIndex>=0 ? s.options[s.selectedIndex].text.trim() : '');
  const fy = (picked.join(' ').match(/20\d\d\s*-\s*\d{2,4}/)||[''])[0];
  const month = picked.find(t=>/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-]*(20\d\d|\d\d)?$/i.test(t))||'';
  return {tables, fy, month};
}
