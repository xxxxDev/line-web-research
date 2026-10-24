(() => {
  const KEY = 'line-web-unread-mode';
  let enabled = localStorage.getItem(KEY) !== '0';
  let badge = '';
  const receipt = raw => {
    try { return new URL(String(raw), location.href).pathname.endsWith('/api/talk/thrift/Talk/TalkService/sendChatChecked'); }
    catch { return false; }
  };
  const reply = () => JSON.stringify({ code: 0, message: 'OK', data: null });
  const nativeHasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function() { return enabled ? false : nativeHasFocus.call(this); };
  window.addEventListener('focus', e => { if (enabled && e.target === window) e.stopImmediatePropagation(); }, true);
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => enabled && receipt(input instanceof Request ? input.url : input)
    ? Promise.resolve(new Response(reply(), { headers: { 'Content-Type': 'application/json' } }))
    : nativeFetch(input, init);
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (enabled && receipt(url)) {
      const blob = URL.createObjectURL(new Blob([reply()], { type: 'application/json' }));
      this.addEventListener('loadend', () => URL.revokeObjectURL(blob), { once: true });
      return nativeOpen.call(this, 'GET', blob, ...args);
    }
    return nativeOpen.call(this, method, url, ...args);
  };
  const showTitle = () => {
    const title = (enabled ? '[Unread mode] ' : '') + (badge ? `(${badge}) LINE` : 'LINE');
    if (document.title !== title) document.title = title;
  };
  const nativeBadge = chrome.action.setBadgeText;
  chrome.action.setBadgeText = options => {
    badge = String(options?.text || ''); showTitle();
    return nativeBadge(options);
  };
  const mount = () => {
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'line-web-unread-toggle';
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.2 3.9M6.2 6.2C3.5 8.1 2 12 2 12s4 7 10 7a11 11 0 0 0 5-1.2"/></svg>';
    const item = document.createElement('li'); item.append(button);
    const render = () => {
      const label = enabled ? 'Unread mode: on' : 'Unread mode: off';
      button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(enabled));
      button.dataset.tooltip = label; button.style.color = enabled ? '#06c755' : '';
      button.title = enabled ? 'On: opening a chat does not send read receipts. Click to turn off.' : 'Off: opening a chat sends read receipts as usual. Click to turn on.';
      showTitle();
    };
    button.addEventListener('click', () => {
      enabled = !enabled; localStorage.setItem(KEY, enabled ? '1' : '0');
      if (enabled) window.dispatchEvent(new FocusEvent('blur'));
      render();
    });
    const place = () => {
      const sound = document.querySelector('button[aria-label="Sound setting"]');
      const soundItem = sound?.closest('li'), list = soundItem?.parentElement;
      if (list?.tagName === 'UL') {
        item.className = soundItem.className; button.className = sound.className;
        const anchor = document.getElementById('line-web-theme-toggle')?.closest('li') || soundItem;
        if (item.parentElement !== list || item.nextElementSibling !== anchor) list.insertBefore(item, anchor);
      }
      showTitle();
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    render(); place();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
