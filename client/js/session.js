// Ensure user ID persists across sessions
let userId = localStorage.getItem("userId");
if (!userId) {
    userId = "user-" + Math.random().toString(36).substring(7);
    localStorage.setItem("userId", userId);
}

const socket = new WebSocket("ws://localhost:3000");

socket.onopen = () => {
    console.log("Connected to WebSocket server with userId:", userId);
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "cursor-update") {
        updateRemoteCursor(data.userId, data.x, data.y);
    }
};

socket.onclose = () => {
    console.log("Disconnected from WebSocket server");
};

function sendCursorPosition(x, y) {
    const message = JSON.stringify({
        type: "cursor-update",
        userId: userId, // Persisted user ID
        x: x,
        y: y
    });

    socket.send(message);
}

// Track user mouse movement
document.addEventListener("mousemove", (e) => {
    sendCursorPosition(e.clientX, e.clientY);
});

// Function to update remote cursor positions
function updateRemoteCursor(userId, x, y) {
    let cursor = document.getElementById(`cursor-${userId}`);
    
    if (!cursor) {
        cursor = document.createElement("div");
        cursor.id = `cursor-${userId}`;
        cursor.classList.add("remote-cursor");
        document.body.appendChild(cursor);
    }

    cursor.style.position = "absolute";
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    cursor.style.width = "8px";
    cursor.style.height = "8px";
    cursor.style.background = "red";
    cursor.style.borderRadius = "50%";
}
