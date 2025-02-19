class SessionManager {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.socket = null;
    }
    
    connect(sessionId) {
        this.socket = new WebSocket(`${this.serverUrl}/collaboration`);

        this.socket.onopen = () => {
            console.log('Connected to WebSocket server');
            this.send({ type: 'join-session', sessionId });
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('Received:', data);
            // Handle incoming messages (e.g., canvas updates)
        };
        
        this.socket.onclose = () => {
            console.log('WebSocket disconnected');
        };
    }
    
    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    }
}

export default SessionManager;
