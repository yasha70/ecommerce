const statusEl = document.getElementById('status');
function setStatus(text, cls){ statusEl.textContent = text; statusEl.className = cls||''; }

// Focus the calculator tab if one is open (bridge.js answers the ping), else open one.
async function openCalculator(){
  try{
    const tab = await chrome.runtime.sendMessage({type:'gst-ping'});
    if(tab && tab.tabId!=null){
      await chrome.tabs.update(tab.tabId, {active:true});
      await chrome.windows.update(tab.windowId, {focused:true});
      return;
    }
  }catch(err){ /* no calculator open */ }
  await chrome.tabs.create({url:chrome.runtime.getURL('calculator.html')});
}

document.getElementById('capture').addEventListener('click', async ()=>{
  const btn = document.getElementById('capture');
  btn.disabled = true; setStatus('Reading the page...');
  try{
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    const frames = await chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, func:captureGstTables});
    const found = frames.map(f=>f.result).filter(Boolean);
    const tables = found.flatMap(r=>r.tables);
    if(!tables.length){
      setStatus('No table with a GSTIN column on this page. Open TDS and TCS Credit Received, choose the period and the TCS / TDS tab first.', 'err');
      return;
    }
    const hint = found.find(r=>r.month||r.fy)||{};
    const at = Date.now();
    // The calculator picks up (and then removes) every "cap:" entry.
    await chrome.storage.local.set({['cap:'+at]: {at, title:tab.title||'', fy:hint.fy||'', month:hint.month||'', tables}});
    setStatus('Captured '+tables.length+' table'+(tables.length>1?'s':'')+(hint.month ? ' for '+hint.month+(hint.fy ? ' ('+hint.fy+')' : '') : '')+'.', 'ok');
    await openCalculator();
  }catch(err){
    setStatus(/cannot (access|be scripted)|chrome:\/\//i.test(err.message) ? 'This page cannot be read. Open the GST portal tab and try again.' : err.message, 'err');
  }finally{ btn.disabled = false; }
});

document.getElementById('open').addEventListener('click', openCalculator);
