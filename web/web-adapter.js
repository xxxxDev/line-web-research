(async () => {
  // LINE installs an unconditional beforeunload confirmation by default.
  // Register before LINE loads so refresh/close does not show that dialog.
  window.addEventListener('beforeunload', event => {
    event.stopImmediatePropagation();
  }, { capture: true });
  // Read theme before session initialization so the initial page is dark too.
  const THEME_KEY = 'line-web-theme';
  let darkTheme = localStorage.getItem(THEME_KEY) !== 'light';
  const themeStyle = document.createElement('style');
  themeStyle.id = 'line-web-theme-style';
  const scope = 'html[data-line-theme="dark"]';
  const surfaces = {
    '#ffffff': '#1b2430', '#fafafa': '#243244', '#fcfcfc': '#1b2430',
    '#f5f5f5': '#222e3e', '#f6f6f8': '#243244', '#f3f3f3': '#243244',
    '#f4f4f4': '#243244', '#efefef': '#2c3b4e', '#eeeeee': '#2c3b4e',
    '#dddddd': '#344459', '#dfdfdf': '#344459', '#e3e3e4': '#344459',
    '#c8c8c8': '#4b5c73', '#b7b7b7': '#52637a', '#202a43': '#121a26',
    '#c3f69d': '#285840', '#e5f5dc': '#285840'
  };
  const ink = {
    '#000000': '#e7edf5', '#1f1f1f': '#e7edf5', '#333333': '#e7edf5',
    '#444444': '#d3deed', '#555555': '#bfccdd', '#666666': '#bfccdd',
    '#777777': '#b0bfd2', '#949494': '#a7b7cb', '#b7b7b7': '#a7b7cb',
    '#c8c8c8': '#8d9db3', '#707991': '#a8b7cd'
  };
  const recolor = (value, kind) => value.replace(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi, token => {
    let r, g, b, alpha = 1;
    if (token.startsWith('#')) {
      let hex = token.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
      if (hex.length !== 6 && hex.length !== 8) return token;
      [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      if (hex.length === 8) alpha = parseInt(hex.slice(6), 16) / 255;
    } else {
      const parts = token.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3 || parts.length > 4 || token.includes('%')) return token;
      [r, g, b] = parts; alpha = parts[3] ?? 1;
    }
    if (alpha === 0) return token;
    const hex = '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
    const mapped = kind === 'ink' ? ink[hex] : kind === 'border'
      ? ((r === g && g === b && r > 100) ? '#35465c' : undefined) : surfaces[hex];
    if (!mapped) return token;
    const rgb = [1, 3, 5].map(i => parseInt(mapped.slice(i, i + 2), 16));
    return `rgba(${rgb.join(',')},${alpha})`;
  });
  const selectors = text => {
    const result = []; let start = 0, depth = 0, quote = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) { result.push(text.slice(start, i)); start = i + 1; }
    }
    result.push(text.slice(start));
    return result.map(s => s.trim().replace(/^(?:html|:root)(?=[\s.#[:]|$)/, scope))
      .map(s => s.startsWith(scope) ? s : `${scope} ${s}`).join(',');
  };
  const darkRules = rules => [...rules].map(rule => {
    if (rule.type === CSSRule.STYLE_RULE) {
      const declarations = [];
      for (const property of rule.style) {
        const kind = property.startsWith('--') ? (/font|text|icon.*color/.test(property) ? 'ink' : /border/.test(property) ? 'border' : 'surface')
          : /^(color|fill|stroke)$/.test(property) ? 'ink'
          : /^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(property) ? 'border'
          : property === 'background-color' ? 'surface' : null;
        if (!kind) continue;
        const before = rule.style.getPropertyValue(property), after = recolor(before, kind);
        if (before !== after) declarations.push(`${property}:${after}${rule.style.getPropertyPriority(property) ? ' !important' : ''}`);
      }
      return declarations.length ? `${selectors(rule.selectorText)}{${declarations.join(';')}}` : '';
    }
    if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
      return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${darkRules(rule.cssRules)}}`;
    }
    return '';
  }).join('\n');
  const renderTheme = () => {
    document.documentElement.dataset.lineTheme = darkTheme ? 'dark' : 'light';
    document.documentElement.style.colorScheme = darkTheme ? 'dark' : 'light';
  };
  const buildTheme = () => {
    const sheets = [...document.styleSheets].filter(s => s.href && new URL(s.href).origin === location.origin && new URL(s.href).pathname.startsWith('/static/css/'));
    themeStyle.textContent = `${scope},${scope} body{background:#141d29;color:#e7edf5}
${scope} input::placeholder,${scope} textarea::placeholder{color:#a7b7cb}
${scope} input,${scope} textarea,${scope} [contenteditable="true"]{caret-color:#e7edf5}
${scope} ::selection{background:#336349;color:#fff}
${scope} a[href]{color:#8bb8ff}
${scope} [class*="chatroom__"]{background:#141d29}
${scope} [class*="gnb-module__button_action"]:hover{color:#fff}
${scope} #line-web-theme-toggle:focus-visible,${scope} #line-web-unread-toggle:focus-visible{outline:2px solid #91b7ff;outline-offset:2px;border-radius:5px}
${sheets.map(s => { try { return darkRules(s.cssRules); } catch { return ''; } }).join('\n')}`;
    document.head.append(themeStyle);
  };
  renderTheme(); buildTheme();
  document.addEventListener('load', event => { if (event.target.tagName === 'LINK' && event.target.rel === 'stylesheet') buildTheme(); }, true);

  const upstreams = new Set(['line-chrome-gw.line-apps.com', 'legy-jp.line-apps.com', 'legy-backup.line-apps.com', 'obs.line-apps.com', 'obs.line-scdn.net', 'profile.line-scdn.net', 'shop.line-scdn.net', 'stickershop.line-scdn.net', 'static.line-scdn.net', 'ci.line-apps.com', 'cix.line-apps.com', 'uts-front.line-apps.com']);
  const mapURL = input => {
    const u = new URL(String(input), location.href);
    return u.protocol === 'https:' && upstreams.has(u.hostname) && !u.port && !u.username && !u.password ? `${location.origin}/proxy/${u.hostname}${u.pathname}${u.search}` : u.href;
  };
  const nativeFetch = window.fetch.bind(window);
  const sessionResponse = await nativeFetch('/__session', { method: 'POST', headers: { 'X-Line-Web-Session': localStorage.getItem('line-web-session') || '' } });
  if (!sessionResponse.ok) throw new Error('Cannot initialize local LINE session');
  const sessionId = (await sessionResponse.json()).id;
  localStorage.setItem('line-web-session', sessionId);
  // Unread mode: open and read chats without telling LINE they were read.
  // LINE's chat room reports a chat read (sendChatChecked, plus a local "last
  // seen" mark) only while the window has focus, so in unread mode the page
  // reports no focus and never sees window focus events. As a second guard,
  // any read receipt is answered locally with LINE's success reply and never
  // leaves this machine. Opening a chat still loads its messages normally.
  const UNREAD_KEY = 'line-web-unread-mode';
  let unreadMode = localStorage.getItem(UNREAD_KEY) !== '0';
  const isReadReceipt = url => { try { return new URL(String(url), location.href).pathname.endsWith('/api/talk/thrift/Talk/TalkService/sendChatChecked'); } catch { return false; } };
  const receiptReply = () => JSON.stringify({ code: 0, message: 'OK', data: null });
  const nativeHasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function() { return unreadMode ? false : nativeHasFocus.call(this); };
  window.addEventListener('focus', e => { if (unreadMode && e.target === window) e.stopImmediatePropagation(); }, true);
  window.fetch = (input, init) => {
    if (unreadMode && isReadReceipt(input instanceof Request ? input.url : input)) {
      return Promise.resolve(new Response(receiptReply(), { headers: { 'Content-Type': 'application/json' } }));
    }
    const request = new Request(input instanceof Request ? new Request(mapURL(input.url), input) : mapURL(input), init);
    if (request.url.startsWith(location.origin + '/proxy/')) request.headers.set('X-Line-Web-Session', sessionId);
    return nativeFetch(request);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (unreadMode && isReadReceipt(url)) {
      // A same-page blob answers the request; nothing is sent to LINE.
      const reply = URL.createObjectURL(new Blob([receiptReply()], { type: 'application/json' }));
      this.addEventListener('loadend', () => URL.revokeObjectURL(reply), { once: true });
      return nativeOpen.call(this, 'GET', reply, ...args);
    }
    const mapped = mapURL(url); const result = nativeOpen.call(this, method, mapped, ...args);
    if (mapped.startsWith(location.origin + '/proxy/')) this.setRequestHeader('X-Line-Web-Session', sessionId);
    return result;
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource { constructor(url, options) {
    const mapped = new URL(mapURL(url));
    if (mapped.origin === location.origin && mapped.pathname.startsWith('/proxy/')) mapped.searchParams.set('__lw_session', sessionId);
    super(mapped.href, options);
  } };
  const event = () => {
    const listeners = new Set();
    return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), hasListener: f => listeners.has(f), emit: (...args) => listeners.forEach(f => f(...args)) };
  };
  const respond = (value, callback) => { callback?.(value); return Promise.resolve(value); };
  const storage = {
    get: async keys => {
      const data = JSON.parse(localStorage.getItem('line-web-extension-storage') || '{}');
      if (keys == null) return data;
      if (typeof keys === 'string') return { [keys]: data[keys] };
      return Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys)).map(key => [key, data[key] ?? keys[key]]));
    },
    set: async values => localStorage.setItem('line-web-extension-storage', JSON.stringify({ ...await storage.get(null), ...values })),
    remove: async keys => { const data = await storage.get(null); for (const key of [].concat(keys)) delete data[key]; localStorage.setItem('line-web-extension-storage', JSON.stringify(data)); },
    clear: async () => localStorage.removeItem('line-web-extension-storage')
  };
  let badge = '';
  function showTitle() { document.title = (unreadMode ? '[Unread mode] ' : '') + (badge ? `(${badge}) LINE` : 'LINE'); }
  const changed = event(), clicked = event(), closed = event();
  const notifications = new Map();
  let downloadId = 0;
  const chrome = window.chrome || {};
  Object.assign(chrome, {
    runtime: { id: 'ophjlpahpchlmihnnnihgmmeilfjmjjc', getURL: value => new URL(value, location.origin).href, getManifest: () => ({ version: '3.7.2' }) },
    storage: { local: storage },
    tabs: { getZoom: callback => respond(1, callback) },
    windows: { getCurrent: callback => respond({ id: 1 }, callback), getAll: callback => respond([{ id: 1 }], callback), update: (_id, _options, callback) => { window.focus(); return respond({ id: 1 }, callback); } },
    extension: { getViews: () => [window, ...popupWindows] },
    action: { setBadgeText: ({ text }) => { badge = text; showTitle(); return Promise.resolve(); } },
    cookies: { remove: async ({ url, name }) => {
      if (new URL(url).origin !== 'https://line-chrome-gw.line-apps.com' || name !== 'lct') throw new Error('Unsupported cookie');
      const response = await nativeFetch('/__clear-login-cookie', { method: 'POST', headers: { 'X-Line-Web-Session': sessionId } });
      if (!response.ok) throw new Error('Cookie removal failed');
      return { url, name };
    } },
    downloads: {
      onChanged: changed,
      download: async ({ url, filename }) => {
        if (!url.startsWith(`blob:${location.origin}/`)) throw new Error('Local attachment required');
        const id = ++downloadId;
        const link = document.createElement('a'); link.href = url; link.download = filename || 'download';
        document.body.append(link); link.click(); link.remove();
        // Browsers do not expose a download-completed event to ordinary pages.
        // Release LINE's queue after handing the blob to the browser download UI.
        setTimeout(() => changed.emit({ id, state: { current: 'complete' } }), 1500);
        return id;
      },
      open: async () => { /* File opening remains in the browser's downloads UI. */ }
    },
    notifications: {
      onClicked: clicked, onClosed: closed,
      create: async (id, options) => {
        if (!('Notification' in window) || Notification.permission !== 'granted') return id;
        const n = new Notification(options.title || 'LINE', { body: options.message || '', silent: !!options.silent });
        notifications.set(id, n); n.onclick = () => { window.focus(); clicked.emit(id); }; n.onclose = () => { notifications.delete(id); closed.emit(id); }; return id;
      },
      clear: async id => { const n = notifications.get(id); n?.close(); notifications.delete(id); return !!n; }
    }
  });
  window.chrome = chrome;
  // Keep LINE's React portal in its own same-origin Window, inside a dialog.
  // Only LINE's popup entry is intercepted; external links retain native open.
  const popupWindows = new Set();
  const nativeWindowOpen = window.open.bind(window);
  const popupByName = new Map();
  window.open = (url, target, features) => {
    if (url === '') {
      const popup = popupByName.get(target) || [...popupWindows].find(view => view.name === target);
      if (popup) { popup.focus(); return popup; }
    }
    let destination;
    try { destination = new URL(String(url), location.href); } catch { return nativeWindowOpen(url, target, features); }
    if (destination.origin !== location.origin || destination.pathname !== '/popup.html' || destination.search || destination.hash) {
      return nativeWindowOpen(url, target, features);
    }
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'line-web-popup';
    dialog.setAttribute('aria-label', 'LINE popup');
    dialog.style.cssText = 'padding:0;border:1px solid #607086;border-radius:12px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:hidden;background:Canvas;color:CanvasText;box-shadow:0 18px 70px #0008';
    const sizes = Object.fromEntries(String(features || '').split(',').map(part => part.trim().split('=')));
    const size = (value, fallback, min, max) => Math.min(max, Math.max(min, Number(value) || fallback));
    const width = size(sizes.width, 640, 280, 1200), height = size(sizes.height, 540, 200, 1000);
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #607086;gap:12px';
    const heading = document.createElement('span'); heading.textContent = 'LINE';
    const closeButton = document.createElement('button');
    closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close popup'); closeButton.textContent = '×';
    closeButton.style.cssText = 'font-size:24px;width:32px;height:32px;color:inherit;cursor:pointer';
    header.append(heading, closeButton);
    const frame = document.createElement('iframe');
    frame.title = 'LINE popup content';
    frame.style.cssText = `display:block;border:0;width:min(${width}px,calc(100vw - 26px));height:min(${height}px,calc(100dvh - 84px));background:transparent`;
    // about:blank inherits this origin/CSP and never visits another port.
    dialog.append(header, frame); document.body.append(dialog);
    const popup = frame.contentWindow;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      popup.dispatchEvent(new Event('unload'));
      popupWindows.delete(popup);
      for (const [name, view] of popupByName) if (view === popup) popupByName.delete(name);
      dialog.close(); dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><script defer src="/static/js/popup.js"></script></head><body></body></html>');
    Object.defineProperty(popup, 'closed', { configurable: true, get: () => closed });
    Object.defineProperty(popup, 'opener', { configurable: true, value: window });
    popup.close = close;
    popup.focus = () => { if (!closed) { frame.focus(); popup.dispatchEvent(new Event('focus')); } };
    popup.open = (nextURL, nextTarget, nextFeatures) => {
      if (nextURL === '') { popupByName.set(nextTarget, popup); popup.focus(); return popup; }
      return window.open(nextURL, nextTarget, nextFeatures);
    };
    popup.moveTo = () => {};
    popup.resizeBy = (dx, dy) => {
      frame.style.width = `min(${size(frame.clientWidth + Number(dx), width, 280, 1200)}px,calc(100vw - 26px))`;
      frame.style.height = `min(${size(frame.clientHeight + Number(dy), height, 200, 1000)}px,calc(100dvh - 84px))`;
      popup.dispatchEvent(new Event('resize'));
    };
    popup.document.hasFocus = () => !unreadMode && document.hasFocus() && document.activeElement === frame;
    // Use the existing network/session bridge for code executing in the frame.
    popup.fetch = window.fetch;
    popup.chrome = window.chrome;
    popupWindows.add(popup);
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    popup.document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); close();
      }
    });
    const observer = new MutationObserver(() => {
      heading.textContent = popup.document.title || 'LINE';
    });
    observer.observe(popup.document, { childList: true, subtree: true });
    dialog.addEventListener('close', () => { observer.disconnect(); if (!closed) close(); }, { once: true });
    popup.document.close(); dialog.showModal();
    return popup;
  };

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'line-web-unread-toggle';
  toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.2 3.9M6.2 6.2C3.5 8.1 2 12 2 12s4 7 10 7a11 11 0 0 0 5-1.2"/></svg>';
  const toggleItem = document.createElement('li');
  toggleItem.append(toggle);
  const showMode = () => {
    const label = unreadMode ? 'Unread mode: on' : 'Unread mode: off';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(unreadMode));
    toggle.dataset.tooltip = label;
    toggle.style.color = unreadMode ? '#06c755' : '';
    toggle.title = unreadMode ? 'On: opening a chat does not show as read to others. Click to turn off; after that, the open chat is marked read the next time this window gets focus.' : 'Off: opening a chat marks it read as usual. Click to turn on unread mode.';
    showTitle();
  };
  toggle.addEventListener('click', () => {
    unreadMode = !unreadMode;
    localStorage.setItem(UNREAD_KEY, unreadMode ? '1' : '0');
    // Tell an already open chat the window lost focus, so it stops marking read.
    if (unreadMode) window.dispatchEvent(new FocusEvent('blur'));
    showMode();
  });
  showMode();
  const themeToggle = document.createElement('button');
  themeToggle.type = 'button'; themeToggle.id = 'line-web-theme-toggle';
  const themeItem = document.createElement('li'); themeItem.append(themeToggle);
  const showTheme = () => {
    renderTheme();
    for (const popup of popupWindows) {
      popup.document.documentElement.dataset.lineTheme = darkTheme ? 'dark' : 'light';
      popup.document.documentElement.style.colorScheme = darkTheme ? 'dark' : 'light';
    }
    const label = darkTheme ? 'Dark theme: on' : 'Dark theme: off';
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('aria-pressed', String(darkTheme));
    themeToggle.dataset.tooltip = label;
    themeToggle.title = darkTheme ? 'Dark theme is on. Click to switch to light.' : 'Dark theme is off. Click to switch to dark.';
    themeToggle.innerHTML = darkTheme
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 13.4A9 9 0 0 1 10.6 3.2a9 9 0 1 0 10.2 10.2z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/></svg>';
  };
  themeToggle.addEventListener('click', () => {
    darkTheme = !darkTheme;
    localStorage.setItem(THEME_KEY, darkTheme ? 'dark' : 'light');
    showTheme();
  });
  showTheme();
  // LINE renders its navigation asynchronously and may replace it on login.
  // Reuse the native list/button styles without changing the vendor bundle.
  const mountToggle = () => {
    const sound = document.querySelector('button[aria-label="Sound setting"]');
    const soundItem = sound?.closest('li');
    const list = soundItem?.parentElement;
    if (!list || list.tagName !== 'UL') return;
    toggleItem.className = soundItem.className;
    toggle.className = sound.className;
    themeItem.className = soundItem.className;
    themeToggle.className = sound.className;
    if (toggleItem.parentElement !== list || themeItem.parentElement !== list || toggleItem.nextElementSibling !== themeItem || themeItem.nextElementSibling !== soundItem) {
      list.insertBefore(toggleItem, soundItem);
      list.insertBefore(themeItem, soundItem);
    }
  };
  new MutationObserver(mountToggle).observe(document.body, { childList: true, subtree: true });
  mountToggle();
  const script = document.createElement('script');
  script.src = location.pathname === '/popup.html' ? '/static/js/popup.js' : '/static/js/main.js';
  document.head.append(script);
})().catch(() => {
  document.body.textContent = 'LINE failed to start. Reload the page or restart the local service.';
});
