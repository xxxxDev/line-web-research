// Share the per-origin preference with the LINE chat page.
const THEME_KEY = 'line-web-theme';
const themeToggle = document.getElementById('portal-theme-toggle');
let darkTheme = true;
try { darkTheme = localStorage.getItem(THEME_KEY) !== 'light'; } catch {}
function renderTheme() {
  document.documentElement.dataset.lineTheme = darkTheme ? 'dark' : 'light';
  themeToggle.textContent = darkTheme ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.setAttribute('aria-label', darkTheme ? 'Dark theme on, switch to light theme' : 'Light theme on, switch to dark theme');
  themeToggle.setAttribute('aria-pressed', String(darkTheme));
}
renderTheme();
themeToggle.addEventListener('click', () => {
  darkTheme = !darkTheme;
  try { localStorage.setItem(THEME_KEY, darkTheme ? 'dark' : 'light'); } catch {}
  renderTheme();
});
window.addEventListener('storage', event => {
  if (event.key === THEME_KEY || event.key === null) {
    darkTheme = event.newValue !== 'light'; renderTheme();
  }
});

document.getElementById('notifications').addEventListener('click', async () => {
  const status = document.getElementById('notification-status');
  if (!('Notification' in window)) { status.textContent = 'This browser does not support web notifications.'; return; }
  const permission = await Notification.requestPermission();
  status.textContent = permission === 'granted' ? 'Notifications allowed.' : 'Notifications not allowed. You can change this in browser settings.';
});

const instanceList = document.getElementById('instances');
const addInstance = document.getElementById('add-instance');
const instanceStatus = document.getElementById('instance-status');
async function loadInstances() {
  const response = await fetch('/__instances');
  if (!response.ok) throw new Error('Multiple instances need the background service. Start it with "Open LINE Web.command".');
  const entries = await response.json();
  instanceList.replaceChildren();
  for (const item of entries) {
    const url = new URL(item.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/index.html') throw new Error('Invalid instance URL');
    const row = document.createElement('div'); row.className = 'instance';
    const title = document.createElement('div'); title.textContent = item.label + (url.origin === location.origin ? ' (current)' : '');
    const detail = document.createElement('small'); detail.textContent = `Port ${url.port} · separate login`; title.append(detail);
    const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open LINE';
    const actions = document.createElement('div'); actions.className = 'instance-actions'; actions.append(link);
    if (item.id !== '1') {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${item.label}`);
      remove.disabled = url.origin === location.origin;
      if (remove.disabled) remove.title = 'Delete this instance from the LINE 1 home page';
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete ${item.label}? This stops the instance and clears its saved login. Other instances are not affected.`)) return;
        remove.disabled = true;
        try {
          const response = await fetch(`/__instances/${encodeURIComponent(item.id)}`, {method:'DELETE', headers:{'X-Line-Web-Action':'delete-instance'}});
          if (!response.ok) throw new Error('Delete failed. Reload the list and try again.');
          await loadInstances(); instanceStatus.textContent = `${item.label} deleted.`;
        } catch (error) { instanceStatus.textContent = error.message; remove.disabled = false; }
      });
      actions.append(remove);
    }
    row.append(title, actions); instanceList.append(row);
  }
  addInstance.disabled = entries.length >= 8;
  return entries.length;
}
addInstance.addEventListener('click', async () => {
  addInstance.disabled = true; instanceStatus.textContent = 'Creating a new LINE instance…';
  try {
    const response = await fetch('/__instances', { method: 'POST', headers: { 'X-Line-Web-Action': 'create-instance' } });
    if (!response.ok) throw new Error('Could not add an instance (8 at most). Reload to check the list.');
    const item = await response.json();
    await loadInstances();
    instanceStatus.textContent = `${item.label} created. Click its "Open LINE" to sign in with another account.`;
  } catch (error) { instanceStatus.textContent = error.message; addInstance.disabled = false; }
});
loadInstances().then(() => instanceStatus.textContent = '').catch(error => instanceStatus.textContent = error.message);
