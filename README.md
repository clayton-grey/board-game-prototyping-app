# Board Game Prototyping App

## Overview
An interactive board game prototyping environment that allows multiple users to collaborate in real time. Users can connect to a shared session and interact with a full-screen canvas containing various virtual board game elements.

## Features
- **Real-time collaboration** via WebSockets
- **Scrollable & Zoomable Canvas**
- **User authentication** with JWT
- **Admin panel** for user and project management
- **Project versioning and session persistence**
- **Secure database connection** using PostgreSQL

## Installation

### Prerequisites
- Docker & Docker Compose

### Steps
1. Clone the repository:
   ```sh
   git clone https://github.com/your-repo/board-game-prototyping-app.git
   cd board-game-prototyping-app
   ```
2. Create an `.env` file:
   ```sh
   cp .env.example .env
   ```
3. Start the application with Docker:
   ```sh
   docker-compose up --build
   ```

## Folder Structure
```
board-game-prototyping-app/
├── server/
│   ├── index.js                # Main server file
│   ├── database.js             # PostgreSQL database connection
│   ├── sessionManager.js       # Manages session persistence
│   ├── routes/
│   │   ├── auth.js             # Authentication routes
│   │   ├── projects.js         # Project CRUD & versioning
│   │   ├── admin.js            # Admin controls
│   │   ├── collaboration.js    # WebSocket event handling
│   └── config.js               # Environment variables
│
├── client/
│   ├── index.html              # Base HTML structure
│   ├── js/
│   │   ├── app.js              # Main frontend logic
│   │   ├── canvas.js           # Handles game elements
│   │   ├── session.js          # WebSockets & session state
│   ├── css/
│   │   ├── style.css           # Styling for the UI
├── db-init-scripts/            # NEW: Database initialization folder
│   ├── init.sql                # SQL script to create tables│
├── .env                        # Environment variables
├── docker-compose.yml          # Docker Compose configuration
├── Dockerfile                  # Server Dockerfile
├── package.json                # Node dependencies
└── README.md                   # Project documentation
```

## License
This project is licensed under the MIT License.
