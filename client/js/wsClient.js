// =========================
// FILE: client/js/wsClient.js
// =========================

let ws = null;

/**
 * connectWebSocket(onMessageCallback, onOpenCallback)
 *   - Creates a WebSocket connection using the same protocol/host as the current page.
 *   - onMessageCallback(data) is called for each incoming message object (JSON-parsed).
 *   - onOpenCallback() is called once when the connection is open.
 */
export function connectWebSocket(onMessageCallback, onOpenCallback) {
  // Dynamically choose ws:// or wss:// based on the page location
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = scheme + '://' + window.location.host;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('WebSocket connected.');
    if (typeof onOpenCallback === 'function') {
      onOpenCallback();
    }
  };

  ws.onmessage = (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.error('WS parse error:', err);
      return;
    }
    if (typeof onMessageCallback === 'function') {
      onMessageCallback(data);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket closed.');
    ws = null;
  };
}

/**
 * sendWSMessage(obj)
 *   - Sends the given object as JSON, if the connection is open.
 */
export function sendWSMessage(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket not open; ignoring message:', obj);
    return;
  }
  ws.send(JSON.stringify(obj));
}
