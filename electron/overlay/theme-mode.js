(() => {
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

  const mount = () => {
  const themeToggle = document.createElement('button');
  themeToggle.type = 'button'; themeToggle.id = 'line-web-theme-toggle';
  const themeItem = document.createElement('li'); themeItem.append(themeToggle);
  const showTheme = () => {
    renderTheme();
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
  const place = () => {
    const sound = document.querySelector('button[aria-label="Sound setting"]');
    const soundItem = sound?.closest('li'), list = soundItem?.parentElement;
    if (list?.tagName !== 'UL') return;
    themeItem.className = soundItem.className; themeToggle.className = sound.className;
    if (themeItem.parentElement !== list || themeItem.nextElementSibling !== soundItem) list.insertBefore(themeItem, soundItem);
  };
  new MutationObserver(place).observe(document.body, {childList:true,subtree:true});
  place();
  window.addEventListener('storage', event => {
    if (event.key === THEME_KEY || event.key === null) { darkTheme = event.newValue !== 'light'; showTheme(); }
  });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true}); else mount();
})();
