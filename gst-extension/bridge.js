// Extension-only glue for calculator.html: opens the GST page and hands every table
// captured by the popup ("cap:" entries in chrome.storage) to it.
(function(){
  document.querySelector('[data-page="gst"]').click();

  function pull(){
    chrome.storage.local.get(null, all=>{
      const keys = Object.keys(all).filter(k=>k.startsWith('cap:')).sort();
      keys.forEach(k=>{
        const c = all[k];
        const when = new Date(c.at).toLocaleString('en-IN', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit'});
        document.dispatchEvent(new CustomEvent('gst:captured', {detail:{name:'Portal capture'+(c.month ? ' · '+c.month+(c.fy ? ' '+c.fy : '') : '')+' · '+when, at:c.at, tables:c.tables, fy:c.fy, month:c.month}}));
      });
      if(keys.length) chrome.storage.local.remove(keys);
    });
  }
  pull();
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area==='local' && Object.keys(changes).some(k=>k.startsWith('cap:') && changes[k].newValue)) pull();
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply)=>{
    if(!msg || msg.type!=='gst-ping') return;
    chrome.tabs.getCurrent(tab=>reply({tabId:tab.id, windowId:tab.windowId}));
    return true;
  });
})();
