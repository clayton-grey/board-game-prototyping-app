// =========================
// FILE: client/js/wsClient.js
// =========================

let ws = null;
// let queuedMessages = []; // if you want to queue

export function connectWebSocket(onMessageCallback) {
  ws = new WebSocket("ws://localhost:3000");

  ws.onopen = () => {
    console.log("WebSocket connected.");
    // If you want to flush a queuedMessages array:
    // while (queuedMessages.length > 0) {
    //   const msg = queuedMessages.shift();
    //   ws.send(JSON.stringify(msg));
    // }
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
 * sendWSMessage(obj) => sends the given object as JSON if ws is open.
 */
// eslint-disable-next-line import/prefer-default-export
export function sendWSMessage(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not open, ignoring message:", obj);
    // Or queue if you want:
    // queuedMessages.push(obj);
    return;
  }
  ws.send(JSON.stringify(obj));
}
