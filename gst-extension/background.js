// Opens the full calculator (or focuses the one already open) for the popup and the on-page panel.
async function openCalculator(){
  try{
    const tab = await chrome.runtime.sendMessage({type:'gst-ping'}); // answered by bridge.js in calculator.html
    if(tab && tab.tabId!=null){
      await chrome.tabs.update(tab.tabId, {active:true});
      await chrome.windows.update(tab.windowId, {focused:true});
      return;
    }
  }catch(err){ /* no calculator open */ }
  await chrome.tabs.create({url:chrome.runtime.getURL('calculator.html')});
}

chrome.runtime.onMessage.addListener((msg, sender, reply)=>{
  if(!msg || msg.type!=='gst-open-calculator') return;
  openCalculator().then(()=>reply(true), ()=>reply(false));
  return true;
});

// Chrome only runs content scripts in pages loaded after the extension was installed, updated or
// switched on, so put the panel into GST portal tabs that are already open. This runs each time
// the service worker starts; a tab that already has this copy's panel ignores it (overlay.js
// guard), and a panel left behind by an older copy is replaced.
let injecting = null;
function injectIntoOpenTabs(){
  return injecting || (injecting = (async ()=>{
    const cs = chrome.runtime.getManifest().content_scripts[0];
    for(const tab of await chrome.tabs.query({url:cs.matches})){
      chrome.scripting.executeScript({target:{tabId:tab.id, allFrames:true}, files:cs.js}).catch(()=>{}); // e.g. a tab still loading
    }
  })());
}
injectIntoOpenTabs();
chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);
