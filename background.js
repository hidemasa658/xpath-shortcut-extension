// アイコンクリックでフローティングバーの表示/非表示を切り替え
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-bar' }).catch(() => {});
});

// メッセージ処理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-shortcuts') {
    chrome.storage.local.get('shortcuts', (data) => {
      sendResponse(data.shortcuts || []);
    });
    return true;
  }

  if (msg.type === 'save-shortcuts') {
    chrome.storage.local.set({ shortcuts: msg.shortcuts }, () => {
      // 全タブのcontent.jsに更新通知
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'shortcuts-updated' }).catch(() => {});
        });
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'save-bar-state') {
    chrome.storage.local.set({ barState: msg.state });
  }

  if (msg.type === 'get-bar-state') {
    chrome.storage.local.get('barState', (data) => {
      sendResponse(data.barState || { visible: true, expanded: false, x: 8, y: 8 });
    });
    return true;
  }

  // ピッカー開始を全フレームに中継
  if (msg.type === 'start-picker') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'start-picker', idx: msg.idx }).catch(() => {});
      }
    });
  }
});
