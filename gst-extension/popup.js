// Reads the table on the current tab as soon as the popup opens and shows the calculation.
const $ = id=>document.getElementById(id);
const PANEL_FILES = ['gst-core.js', 'capture.js', 'summary.js', 'overlay.js'];
let settings = {...GST_DEFAULTS}, capture = null, rows = [];
$('gcss').textContent = GST_SUMMARY_CSS;

function setStatus(text, cls){ $('status').textContent = text; $('status').className = cls||''; }
async function activeTab(){ const [tab] = await chrome.tabs.query({active:true, currentWindow:true}); return tab; }

// Every frame of the tab is read; the month comes from the first frame that shows one.
async function readPage(tab){
  const frames = await chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, func:captureGstTables});
  const found = frames.map(f=>f.result).filter(Boolean);
  const hint = found.find(r=>r.month||r.fy)||{};
  return {tables:found.flatMap(r=>r.tables), fy:hint.fy||'', month:hint.month||''};
}

function render(){
  const has = rows.length>0;
  $('result').innerHTML = has ? gstSummaryHtml(rows, settings) : '';
  $('help').hidden = has;
  ['copy', 'panel', 'send'].forEach(id=>{ $(id).disabled = !has; });
}

async function calculate(){
  setStatus('Reading the page...');
  try{
    capture = await readPage(await activeTab());
    rows = gstCalculate(capture, settings);
    if(rows.length) setStatus('');
    else setStatus(capture.tables.length ? 'The table on this page is not a TDS / TCS credit table.' : 'No TDS / TCS table on this page.', 'err');
  }catch(err){
    capture = null; rows = [];
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

$('rate').addEventListener('change', ()=>{
  settings = {...settings, rate:Math.max(0, parseFloat($('rate').value)||0)};
  $('rate').value = settings.rate;
  chrome.storage.local.set({gstSettings:settings}); // the on-page panel follows this too
  if(capture){ rows = gstCalculate(capture, settings); render(); }
});

$('copy').addEventListener('click', async ()=>{
  setStatus(await copyText(gstSummaryText(rows, settings)) ? 'Copied — paste into Excel or Google Sheets.' : 'Could not copy.', 'ok');
});

$('panel').addEventListener('click', async ()=>{
  const tab = await activeTab();
  try{ await chrome.tabs.sendMessage(tab.id, {type:'gst-panel-show'}); }
  catch(err){ // not the GST portal, so the panel script isn't there yet
    await chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, files:PANEL_FILES});
    await chrome.tabs.sendMessage(tab.id, {type:'gst-panel-show'});
  }
  window.close();
});

$('send').addEventListener('click', async ()=>{
  // The calculator picks up (and then removes) every "cap:" entry.
  const at = Date.now();
  await chrome.storage.local.set({['cap:'+at]: {at, title:'', fy:capture.fy, month:capture.month, tables:capture.tables}});
  await chrome.runtime.sendMessage({type:'gst-open-calculator'});
  window.close();
});

$('open').addEventListener('click', async ()=>{
  await chrome.runtime.sendMessage({type:'gst-open-calculator'});
  window.close();
});

chrome.storage.local.get('gstSettings', v=>{
  settings = {...GST_DEFAULTS, ...((v && v.gstSettings)||{})};
  $('rate').value = settings.rate;
  calculate();
});
