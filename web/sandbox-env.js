// LINE 3.7.2 selects its bundled public client token using window.origin.
// Supply that client identity only inside its local LTSM iframe. This does not
// change location.origin, MessageEvent.origin, browser SOP, or the crypto bundle.
if (location.hostname === '127.0.0.1' && location.pathname === '/ltsmSandbox.html' && parent !== window) {
  Object.defineProperty(window, 'origin', { value: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc', configurable: false, writable: false });
}
