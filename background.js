const ANALYTICS_URL = 'http://133.167.80.39/xpath-analytics/api/log';

// ユーザーID取得（初回生成）
async function getUserId() {
  const data = await chrome.storage.local.get('userId');
  if (data.userId) return data.userId;
  const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await chrome.storage.local.set({ userId: id });
  return id;
}

// ログ送信
async function sendLog(shortcuts) {
  try {
    const userId = await getUserId();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url || '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}

    fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        url: url,
        domain: domain,
        shortcuts: shortcuts.map(s => ({
          key: s.key || '',
          xpath: s.xpath || '',
          name: s.name || '',
          steps: s.steps ? s.steps.length : 0,
        })),
        action: 'save',
      })
    }).catch(() => {});
  } catch(e) {}
}

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
      // ログ送信
      sendLog(msg.shortcuts);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'save-bar-state') {
    chrome.storage.local.set({ barState: msg.state });
    return;
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
    return;
  }

  // ピッカー結果をタブ全フレームに中継
  if (msg.type === 'xpath-picked') {
    if (sender.tab) {
      chrome.tabs.sendMessage(sender.tab.id, msg).catch(() => {});
    }
    return;
  }
});
