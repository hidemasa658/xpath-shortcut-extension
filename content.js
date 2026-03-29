// ========== ショートカット監視（全フレーム共通） ==========
let shortcuts = [];

function isXPath(s) { return s && (s.startsWith('/') || s.startsWith('(')); }

function xpathInDoc(xpath, doc) {
  try {
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (e) { return null; }
}

function cssInDoc(sel, doc) {
  try { return doc.querySelector(sel); } catch (e) { return null; }
}

function findElement(selector) {
  if (!selector) return null;
  const fn = isXPath(selector) ? xpathInDoc : cssInDoc;
  let el = fn(selector, document);
  if (el) return el;
  // IDフォールバック
  if (isXPath(selector)) {
    const m = selector.match(/\[@id=["']([^"']+)["']\]/);
    if (m) { el = document.getElementById(m[1]); if (el) return el; }
  }
  // iframe検索
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      el = fn(selector, doc);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

function codeToKeyName(code) {
  if (code.startsWith('Digit')) return code.replace('Digit', '');
  if (code.startsWith('Key')) return code.replace('Key', '');
  if (code.startsWith('Numpad')) return 'Num' + code.replace('Numpad', '');
  const map = {
    Backquote:'`',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',
    Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',
    Slash:'/',Space:'Space',Enter:'Enter',Backspace:'Backspace',
    Tab:'Tab',Escape:'Esc',Delete:'Delete',
    ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',
    F1:'F1',F2:'F2',F3:'F3',F4:'F4',F5:'F5',F6:'F6',
    F7:'F7',F8:'F8',F9:'F9',F10:'F10',F11:'F11',F12:'F12',
  };
  return map[code] || code;
}

function keyEventToString(e) {
  if (['Control','Alt','Shift','Meta'].includes(e.key)) return null;
  const p = [];
  if (e.ctrlKey || e.metaKey) p.push('Ctrl');
  if (e.altKey) p.push('Alt');
  if (e.shiftKey) p.push('Shift');
  p.push(codeToKeyName(e.code));
  return p.join('+');
}

function onKeyDown(e) {
  if (shortcuts.length === 0) return;
  const pressed = keyEventToString(e);
  if (!pressed) return;
  const match = shortcuts.find(s => s.key === pressed);
  if (!match) return;
  e.preventDefault();
  e.stopPropagation();
  const el = findElement(match.xpath);
  if (el) { el.click(); }
}

function loadShortcuts() {
  chrome.runtime.sendMessage({ type: 'get-shortcuts' }, (res) => {
    if (chrome.runtime.lastError) return;
    shortcuts = res || [];
  });
}

// 全フレームでキー監視
loadShortcuts();
document.addEventListener('keydown', onKeyDown, true);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'shortcuts-updated') loadShortcuts();
});

// ========== ピッカー（全フレーム共通） ==========
let picking = false, pickIdx = -1, hlEl = null;

function genSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.classList.length > 0) {
    const s = el.tagName.toLowerCase() + '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
    try { if (document.querySelectorAll(s).length === 1) return s; } catch(e) {}
  }
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    let tag = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
    const parent = cur.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) tag += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
    }
    parts.unshift(tag);
    cur = parent;
  }
  return parts.join(' > ');
}

function showHL(el) {
  removeHL();
  const r = el.getBoundingClientRect();
  hlEl = document.createElement('div');
  hlEl.style.cssText = `position:fixed;z-index:2147483647;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;background:rgba(26,115,232,0.2);border:2px solid #1a73e8;pointer-events:none;border-radius:3px;`;
  document.body.appendChild(hlEl);
}
function removeHL() { if (hlEl) { hlEl.remove(); hlEl = null; } }

function onPMove(e) { if (picking) showHL(e.target); }
function onPClick(e) {
  if (!picking) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  const sel = genSelector(e.target);
  removeHL(); stopPicker();
  chrome.runtime.sendMessage({ type: 'xpath-picked', idx: pickIdx, xpath: sel });
}
function onPKey(e) { if (picking && e.key === 'Escape') { removeHL(); stopPicker(); } }

function startPicker(idx) {
  picking = true; pickIdx = idx;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onPMove, true);
  document.addEventListener('click', onPClick, true);
  document.addEventListener('keydown', onPKey, true);
}
function stopPicker() {
  picking = false; pickIdx = -1;
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', onPMove, true);
  document.removeEventListener('click', onPClick, true);
  document.removeEventListener('keydown', onPKey, true);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start-picker') startPicker(msg.idx);
});

// ========== フローティングバー（トップフレームのみ） ==========
if (window === window.top) {

const ESC = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// Shadow DOMでホストページのスタイルと隔離
const host = document.createElement('div');
host.id = 'xpath-shortcut-host';
host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
document.body.appendChild(host);
const shadow = host.attachShadow({ mode: 'closed' });

const wrapper = document.createElement('div');
wrapper.innerHTML = `
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  :host { font-family: -apple-system, 'Segoe UI', sans-serif; }

  .bar {
    position: fixed;
    background: rgba(30,30,30,0.92);
    border-radius: 8px;
    padding: 4px 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    cursor: move;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
    z-index: 2147483647;
    transition: opacity 0.15s;
  }
  .bar.hidden { display: none; }

  .bar .sc-badge {
    background: rgba(255,255,255,0.15);
    color: #fff;
    font-size: 9px;
    font-family: monospace;
    padding: 2px 5px;
    border-radius: 3px;
    white-space: nowrap;
    cursor: default;
  }
  .bar .sc-name {
    color: rgba(255,255,255,0.6);
    font-size: 8px;
    max-width: 50px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar .sc-item {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .bar .sep {
    width: 1px;
    height: 12px;
    background: rgba(255,255,255,0.2);
    margin: 0 1px;
  }
  .bar .expand-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.6);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
  }
  .bar .expand-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }

  /* 展開パネル */
  .panel {
    position: fixed;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    width: 280px;
    max-height: 420px;
    overflow-y: auto;
    padding: 10px;
    font-size: 11px;
    color: #333;
    z-index: 2147483647;
  }
  .panel.hidden { display: none; }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .panel-header h2 { font-size: 12px; color: #1a73e8; }
  .panel-close {
    background: none; border: none; font-size: 16px;
    cursor: pointer; color: #999; line-height: 1;
  }
  .panel-close:hover { color: #333; }

  .sc-card {
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 6px;
  }
  .sc-card label {
    display: block; font-size: 9px; color: #888; margin-bottom: 2px;
  }
  .sc-card input {
    width: 100%; padding: 4px 6px; border: 1px solid #ccc;
    border-radius: 3px; font-size: 10px; margin-bottom: 4px;
    font-family: inherit;
  }
  .sc-card input:focus { outline: none; border-color: #1a73e8; }
  .sc-card .key-inp { background: #e8f0fe; cursor: pointer; }
  .sc-card .key-inp:focus { background: #d2e3fc; }
  .sc-card .sel-row { display: flex; gap: 3px; margin-bottom: 4px; }
  .sc-card .sel-row input { margin-bottom: 0; }
  .sc-card .pick-btn {
    flex-shrink: 0; width: 24px; height: 24px;
    border: 1px solid #1a73e8; border-radius: 3px;
    background: #e8f0fe; color: #1a73e8; cursor: pointer;
    font-size: 13px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
  }
  .sc-card .pick-btn:hover { background: #d2e3fc; }
  .sc-card .del-btn {
    background: none; border: 1px solid #e53935; color: #e53935;
    padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 9px;
  }
  .sc-card .del-btn:hover { background: #fbe9e7; }

  .add-btn {
    width: 100%; padding: 6px; background: #1a73e8; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-size: 11px;
  }
  .add-btn:hover { background: #1557b0; }

  .toast {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 4px 12px; border-radius: 4px;
    font-size: 10px; opacity: 0; transition: opacity 0.2s; pointer-events: none;
    z-index: 2147483647;
  }
  .toast.show { opacity: 1; }
</style>

<div class="bar hidden" id="bar"></div>
<div class="panel hidden" id="panel"></div>
<div class="toast" id="toast"></div>
`;
shadow.appendChild(wrapper);

const barEl = shadow.getElementById('bar');
const panelEl = shadow.getElementById('panel');
const toastEl = shadow.getElementById('toast');

let barState = { visible: true, expanded: false, x: 8, y: 8 };

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1200);
}

function saveState() {
  chrome.runtime.sendMessage({ type: 'save-bar-state', state: barState });
}

// バー描画
function renderBar() {
  barEl.classList.toggle('hidden', !barState.visible || barState.expanded);
  barEl.style.left = barState.x + 'px';
  barEl.style.top = barState.y + 'px';

  let html = '';
  shortcuts.forEach(sc => {
    if (!sc.key) return;
    html += `<div class="sc-item"><span class="sc-badge">${ESC(sc.key)}</span>`;
    if (sc.name) html += `<span class="sc-name">${ESC(sc.name)}</span>`;
    html += `</div>`;
  });
  if (shortcuts.length > 0) html += '<div class="sep"></div>';
  html += '<button class="expand-btn" id="expand-btn">⚙</button>';
  barEl.innerHTML = html;

  shadow.getElementById('expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    barState.expanded = true;
    saveState();
    renderBar();
    renderPanel();
  });
}

// パネル描画
function renderPanel() {
  panelEl.classList.toggle('hidden', !barState.expanded);
  panelEl.style.left = barState.x + 'px';
  panelEl.style.top = barState.y + 'px';

  let html = `<div class="panel-header"><h2>XPath Shortcut</h2><button class="panel-close" id="panel-close">×</button></div>`;

  shortcuts.forEach((sc, i) => {
    html += `<div class="sc-card">
      <label>メモ</label>
      <input type="text" class="name-inp" data-i="${i}" value="${ESC(sc.name||'')}" placeholder="例: ダッシュボードへ戻る">
      <label>キー</label>
      <input type="text" class="key-inp" data-i="${i}" value="${ESC(sc.key||'')}" readonly placeholder="クリックしてキーを押す">
      <label>セレクタ</label>
      <div class="sel-row">
        <input type="text" class="sel-inp" data-i="${i}" value="${ESC(sc.xpath||'')}" placeholder="#id / .class / //xpath">
        <button class="pick-btn" data-i="${i}">+</button>
      </div>
      <button class="del-btn" data-i="${i}">削除</button>
    </div>`;
  });
  html += '<button class="add-btn" id="add-btn">+ 追加</button>';
  panelEl.innerHTML = html;

  // イベント
  shadow.getElementById('panel-close').addEventListener('click', () => {
    barState.expanded = false;
    saveState();
    renderBar();
    renderPanel();
  });

  shadow.getElementById('add-btn').addEventListener('click', () => {
    shortcuts.push({ key: '', xpath: '', name: '' });
    saveShortcuts();
    renderPanel();
    renderBar();
  });

  panelEl.querySelectorAll('.name-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      shortcuts[+e.target.dataset.i].name = e.target.value;
      saveShortcuts();
      renderBar();
    });
  });

  panelEl.querySelectorAll('.key-inp').forEach(inp => {
    inp.addEventListener('focus', () => { inp.value = ''; inp.placeholder = 'キーを押す...'; });
    inp.addEventListener('blur', (e) => {
      const i = +e.target.dataset.i;
      if (!e.target.value) e.target.value = shortcuts[i].key;
      e.target.placeholder = 'クリックしてキーを押す';
    });
    inp.addEventListener('keydown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(codeToKeyName(e.code));
      const combo = parts.join('+');
      shortcuts[+e.target.dataset.i].key = combo;
      e.target.value = combo;
      saveShortcuts();
      renderBar();
    });
  });

  panelEl.querySelectorAll('.sel-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      shortcuts[+e.target.dataset.i].xpath = e.target.value;
      saveShortcuts();
    });
  });

  panelEl.querySelectorAll('.pick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = +e.target.dataset.i;
      chrome.runtime.sendMessage({ type: 'start-picker', idx });
      toast('要素をクリック（Escでキャンセル）');
    });
  });

  panelEl.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      shortcuts.splice(+e.target.dataset.i, 1);
      saveShortcuts();
      renderPanel();
      renderBar();
    });
  });
}

function saveShortcuts() {
  chrome.runtime.sendMessage({ type: 'save-shortcuts', shortcuts }, () => {});
}

// ドラッグ
let dragging = false, dragOX = 0, dragOY = 0;

barEl.addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'BUTTON') return;
  dragging = true;
  dragOX = e.clientX - barState.x;
  dragOY = e.clientY - barState.y;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  barState.x = Math.max(0, e.clientX - dragOX);
  barState.y = Math.max(0, e.clientY - dragOY);
  barEl.style.left = barState.x + 'px';
  barEl.style.top = barState.y + 'px';
});

document.addEventListener('mouseup', () => {
  if (dragging) { dragging = false; saveState(); }
});

// アイコンクリックでバー表示/非表示
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle-bar') {
    barState.visible = !barState.visible;
    if (!barState.visible) barState.expanded = false;
    saveState();
    renderBar();
    renderPanel();
  }
  if (msg.type === 'xpath-picked' && msg.idx >= 0 && msg.idx < shortcuts.length) {
    shortcuts[msg.idx].xpath = msg.xpath;
    saveShortcuts();
    renderPanel();
    toast('セレクタを設定しました');
  }
  if (msg.type === 'shortcuts-updated') {
    loadShortcuts();
    setTimeout(() => { renderBar(); }, 100);
  }
});

// 初期化
chrome.runtime.sendMessage({ type: 'get-bar-state' }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res) barState = res;
  loadShortcuts();
  setTimeout(() => { renderBar(); renderPanel(); }, 200);
});

} // end if (window === window.top)
