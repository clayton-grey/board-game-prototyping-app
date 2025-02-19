document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    const ctx = canvas.getContext("2d");

    // Create a separate canvas layer for cursors
    const cursorCanvas = document.createElement("canvas");
    document.body.appendChild(cursorCanvas);
    cursorCanvas.width = canvas.width;
    cursorCanvas.height = canvas.height;
    cursorCanvas.style.position = "absolute";
    cursorCanvas.style.left = "0";
    cursorCanvas.style.top = "0";
    cursorCanvas.style.pointerEvents = "none";
    const cursorCtx = cursorCanvas.getContext("2d");

    // Track remote cursors
    let remoteCursors = {};
    let userId = localStorage.getItem("userId");
    if (!userId) {
        userId = "user-" + Math.random().toString(36).substring(7);
        localStorage.setItem("userId", userId);
    }

    // Resize canvas to fit window
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        cursorCanvas.width = window.innerWidth;
        cursorCanvas.height = window.innerHeight;
        drawCanvas();
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    // Render function
    function drawCanvas() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ddd";
        ctx.fillRect(0, 0, 1000, 1000); // Example board

        // Clear cursor canvas before drawing
        cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

        for (const id in remoteCursors) {
            if (id !== userId) { // Avoid duplicating the local cursor
                const { x, y } = remoteCursors[id];
                drawCursor(x, y, id);
            }
        }
    }

    function drawCursor(x, y, id) {
        cursorCtx.fillStyle = id === userId ? "blue" : "red";
        cursorCtx.beginPath();
        cursorCtx.arc(x, y, 5, 0, 2 * Math.PI);
        cursorCtx.fill();

        cursorCtx.fillStyle = "black";
        cursorCtx.font = "12px Arial";
        cursorCtx.fillText(id, x + 10, y - 10);
    }

    // WebSocket Integration for Cursor Updates
    const socket = new WebSocket("ws://localhost:3000");

    socket.onopen = () => {
        console.log("Connected to WebSocket server");
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "cursor-updates") {
            remoteCursors = data.cursors;
            drawCanvas();
        }
    };

    socket.onclose = () => {
        console.log("Disconnected from WebSocket server");
    };

    function sendCursorPosition(x, y) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "cursor-update",
                userId,
                x, y
            }));
        } else {
            console.warn("WebSocket not open. Retrying in 500ms...");
            setTimeout(() => sendCursorPosition(x, y), 500);
        }
    }

    document.addEventListener("mousemove", (e) => {
        sendCursorPosition(e.clientX, e.clientY);
    });
});
