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
