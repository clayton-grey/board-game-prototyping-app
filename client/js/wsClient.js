// =========================
// FILE: client/js/wsClient.js
// =========================

let ws = null;

/**
 * connectWebSocket(onMessageCallback)
 *  - Creates a WebSocket to ws://localhost:3000
 *  - Invokes `onMessageCallback(parsedData)` for each incoming message.
 */
export function connectWebSocket(onMessageCallback) {
  ws = new WebSocket("ws://localhost:3000");

  ws.onopen = () => {
    console.log("WebSocket connected.");
  };

  ws.onmessage = (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.error("WS parse error:", err);
      return;
    }
    if (typeof onMessageCallback === "function") {
      onMessageCallback(data);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket closed.");
    ws = null;
  };
}

/**
 * sendWSMessage(obj)
 *  - Sends the given object as JSON if the WebSocket is open.
 */
export function sendWSMessage(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    // Optionally queue messages or log an error
    // For now, just log
    console.warn("WebSocket not open. Unable to send message:", obj);
    return;
  }
  ws.send(JSON.stringify(obj));
}
