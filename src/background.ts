// Toolbar button and Alt+T (the manifest's _execute_action shortcut) toggle the panel.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Fails on non-YouTube tabs and on tabs opened before the extension was (re)loaded.
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }).catch(() => {});
});
