// Reads the table on the current tab as soon as the popup opens and shows the calculation,
// for this page or for everything collected from the pages and months opened so far.
const $ = id=>document.getElementById(id);
const PANEL_FILES = ['gst-core.js', 'capture.js', 'summary.js', 'overlay.js'];
let settings = {...GST_DEFAULTS}, capture = null, pageRecs = [], coll = null, view = 'page';
$('gcss').textContent = GST_SUMMARY_CSS;

function setStatus(text, cls){ $('status').textContent = text; $('status').className = cls||''; }
async function activeTab(){ const [tab] = await chrome.tabs.query({active:true, currentWindow:true}); return tab; }

// Every frame of the tab is read straight away (no waiting for slow frames to finish loading);
// the month comes from the first frame that shows one.
async function readPage(tab){
  const frames = await chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, func:captureGstTables, injectImmediately:true});
  const found = frames.map(f=>f.result).filter(Boolean);
  const hint = found.find(r=>r.month||r.fy)||{};
  return {tables:found.flatMap(r=>r.tables), fy:hint.fy||'', month:hint.month||'', sig:found.map(r=>r.sig).join(''), hasNextPage:found.some(r=>r.hasNextPage)};
}

function shownRows(){ return GstCore.summarizePortal(view==='all' ? gstCollectedRecords(coll, Date.now()) : pageRecs, settings.tol); }

function render(){
  const rows = shownRows(), has = rows.length>0, info = gstCollectionInfo(coll, Date.now());
  $('view-page').classList.toggle('on', view==='page');
  $('view-all').classList.toggle('on', view==='all');
  $('view-all').textContent = 'All collected'+(info.pages ? ' · '+info.pages+' page'+(info.pages>1?'s':'') : '');
  $('info').innerHTML = view==='all'
    ? (info.rows ? `${info.rows} row${info.rows>1?'s':''} from ${info.pages} page${info.pages>1?'s':''}${info.months ? ' · '+info.months : ''} · since ${info.since}. <button id="clear">Clear</button>` : 'Nothing collected yet — open the pages or months you need on the portal.')
    : (info.pages>1 ? `You have opened ${info.pages} pages — the combined total is under All collected.` : '');
  if($('clear')) $('clear').addEventListener('click', async ()=>{ // start again from this page
    coll = gstAddToCollection(null, pageRecs, capture && capture.sig, Date.now());
    await (coll ? chrome.storage.local.set({gstCollection:coll}) : chrome.storage.local.remove('gstCollection'));
    render();
  });
  $('result').innerHTML = has ? gstSummaryHtml(rows, settings) : '';
  $('help').hidden = has || view==='all';
  $('read-all').hidden = !(capture && capture.hasNextPage && pageRecs.length);
  ['copy', 'panel', 'send'].forEach(id=>{ $(id).disabled = !has; });
  $('panel').disabled = !pageRecs.length;
}

async function calculate(){
  setStatus('Reading the page...');
  try{
    capture = await readPage(await activeTab());
    pageRecs = gstRecords(capture);
    const next = gstAddToCollection(coll, pageRecs, capture.sig, Date.now());
    if(next){ coll = next; await chrome.storage.local.set({gstCollection:coll}); }
    if(pageRecs.length || view==='all') setStatus('');
    else setStatus(capture.tables.length ? 'The table on this page is not a TDS / TCS credit table.' : 'No TDS / TCS table on this page.', 'err');
  }catch(err){
    capture = null; pageRecs = [];
    setStatus(/cannot (access|be scripted)|chrome:\/\/|extensions gallery|edge:\/\//i.test(err.message) ? 'This page cannot be read. Open the GST portal tab and try again.' : err.message, 'err');
  }
  render();
}

async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(err){
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// The live panel does the clicking through pages, so make sure it is on the page first.
async function toPanel(type){
  const tab = await activeTab();
  try{ await chrome.tabs.sendMessage(tab.id, {type}); }
  catch(err){ // not the GST portal, so the panel script isn't there yet
    await chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, files:PANEL_FILES, injectImmediately:true});
    await chrome.tabs.sendMessage(tab.id, {type});
  }
  window.close();
}

$('view-page').addEventListener('click', ()=>{ view = 'page'; setStatus(''); render(); });
$('view-all').addEventListener('click', ()=>{ view = 'all'; setStatus(''); render(); });

$('rate').addEventListener('change', ()=>{
  settings = {...settings, rate:Math.max(0, parseFloat($('rate').value)||0)};
  $('rate').value = settings.rate;
  chrome.storage.local.set({gstSettings:settings}); // the on-page panel follows this too
  render();
});

$('copy').addEventListener('click', async ()=>{
  setStatus(await copyText(gstSummaryText(shownRows(), settings)) ? 'Copied — paste into Excel or Google Sheets.' : 'Could not copy.', 'ok');
});
$('panel').addEventListener('click', ()=>toPanel('gst-panel-show'));
$('read-all').addEventListener('click', ()=>toPanel('gst-read-all'));

$('send').addEventListener('click', async ()=>{
  // The calculator picks up (and then removes) every "cap:" entry.
  const at = Date.now();
  const entry = view==='all'
    ? {at, title:'All collected', fy:'', month:'', tables:gstRecordsToTables(gstCollectedRecords(coll, at))}
    : {at, title:'', fy:capture.fy, month:capture.month, tables:capture.tables};
  await chrome.storage.local.set({['cap:'+at]: entry});
  await chrome.runtime.sendMessage({type:'gst-open-calculator'});
  window.close();
});

$('open').addEventListener('click', async ()=>{
  await chrome.runtime.sendMessage({type:'gst-open-calculator'});
  window.close();
});

chrome.storage.local.get(['gstSettings', 'gstCollection'], v=>{
  settings = {...GST_DEFAULTS, ...((v && v.gstSettings)||{})};
  coll = (v && v.gstCollection) || null;
  $('rate').value = settings.rate;
  calculate();
});
