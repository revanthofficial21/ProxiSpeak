# ProxiSpeak
ProxiSpeak – Geospatial Proximity Audio Ecosystem

A real-time virtual collaboration environment designed to connect users through avatar movement and proximity-aware audio.

**Technology Stack:** React, Node.js, Express.js, Socket.IO, MongoDB

## 1. Project Overview

ProxiSpeak is a full-stack web application that creates a shared 2D virtual environment where users are represented by avatars. The application is designed to synchronize avatar positions between connected browser clients and provide the foundation for proximity-based audio communication.

The project combines a React-based frontend with a Node.js backend, real-time communication through Socket.IO, and planned MongoDB integration for persistent position data and spatial queries.

## 2. Problem Statement

Traditional remote collaboration tools do not naturally recreate the experience of interacting with people nearby in a shared physical environment.

ProxiSpeak aims to provide a virtual space where users can move around, observe other participants, and eventually communicate through distance-aware audio interactions.

## 3. Project Objectives

- Develop a shared 2D virtual environment.
- Synchronize avatar positions between connected clients.
- Handle player connections and disconnections in real time.
- Design a database structure for player and position data.
- Prepare for proximity calculations and spatial queries.
- Establish a foundation for real-time voice communication.

## 4. Team Details and Responsibilities

| Team Member | Role |
|---|---|
| Revanth | Project Lead, Backend Development and Integration |
| Vivek | Frontend Development |
| Janakirani Venkatesan | WebRTC Research and Testing |
| Naseema | Database Development and Position Data |

### Individual Contribution — Naseema

My responsibility is Database Development, focusing on MongoDB and virtual-world position data.

Key responsibilities:

- Design a MongoDB data model for player information and avatar coordinates.
- Define how player identifiers and X/Y coordinates should be represented.
- Plan the storage structure for position data.
- Coordinate the database model with the backend movement-event structure.
- Prepare for future proximity calculations and spatial queries.
- Support integration between the database and backend modules.

**Development status:** MongoDB connection and position persistence are in progress. Database features should be marked complete only after implementation and testing.

## 5. Technology Stack

| Technology | Purpose |
|---|---|
| React | Frontend application |
| Vite | Frontend development tooling |
| JavaScript | Application logic |
| HTML Canvas API | Virtual-world rendering |
| CSS | Interface styling |
| Node.js | Backend runtime |
| Express.js | HTTP server and API endpoints |
| Socket.IO | Real-time communication |
| MongoDB | Planned persistent position storage |
| WebRTC | Planned audio communication |
| Git and GitHub | Version control and collaboration |
| Visual Studio Code | Development environment |

## 6. System Architecture

The application follows a client-server architecture.

1. The React frontend renders the virtual environment and avatar interface.
2. Socket.IO communicates player movement between browser clients and the backend.
3. The Node.js and Express server manages connections and player state.
4. MongoDB is planned to store player information and position data.
5. WebRTC and the Web Audio API are planned for proximity-based audio features.

### Database Development Approach

The initial virtual world uses X/Y coordinates measured in virtual-world units. A MongoDB document can represent a player using fields such as:

- `playerId` — unique player identifier
- `x` — horizontal position
- `y` — vertical position
- `updatedAt` — last position update time

Because the current world uses a 2D coordinate system, a MongoDB `2d` index may be appropriate for planar spatial queries if needed. The final schema and indexing strategy will be confirmed during implementation.

## 7. Project Structure

```text
ProxiSpeak/
├── client/
│   └── React frontend
├── server/
│   ├── index.js
│   ├── package.json
│   ├── package-lock.json
│   └── .env
├── .gitignore
└── README.md
```

The `.env` file contains local environment configuration and must not be committed to GitHub.

## 8. Backend Foundation

The backend is built using Node.js, Express.js, and Socket.IO.

The current server implementation includes:

- Express application setup.
- HTTP server configuration.
- Socket.IO server integration.
- Player connection and disconnection handling.
- In-memory player tracking.
- Initial player positions.
- Movement-coordinate validation.
- World-boundary checks.
- Real-time position broadcasting.
- A basic HTTP health endpoint.

Player positions are currently maintained in memory. Persistent MongoDB storage is a separate development task.

## 9. Real-Time Communication Events

| Event | Purpose |
|---|---|
| `connection` | Handles a new client connection |
| `world:state` | Sends the current player list |
| `player:joined` | Announces a new player |
| `player:move` | Receives movement coordinates |
| `player:moved` | Broadcasts an updated position |
| `player:left` | Announces a disconnected player |
| `disconnect` | Removes disconnected player state |

## 10. Running the Backend Locally

### Prerequisites

- Node.js and npm
- Git
- Visual Studio Code
- MongoDB Atlas account or a local MongoDB instance

### Installation

Clone the repository:

```bash
git clone https://github.com/revanthofficial21/ProxiSpeak.git
cd ProxiSpeak
```

Navigate to the backend directory:

```bash
cd server
npm install
```

Create a `.env` file inside `server/`:

```env
MONGODB_URI=your_mongodb_connection_string
```

Do not share or commit real database credentials.

Start the development server:

```bash
npm run dev
```

The server is configured to use port `3000` by default.

Check the health endpoint at:

`http://localhost:3000`

MongoDB authentication must succeed before the current server startup process can complete successfully.

## 11. Development Progress

### Backend foundation

- Express and HTTP server setup.
- Socket.IO configuration.
- Player-state management in memory.
- Movement-event handling and coordinate validation.
- Player join and disconnect handling.

### Database development

- MongoDB Atlas setup initiated.
- Connection configuration added to the backend.
- Database authentication troubleshooting in progress.
- Position schema and persistent storage remain to be implemented and tested.

### Planned development

- Save player positions to MongoDB.
- Implement and test proximity queries.
- Integrate frontend and persistent database state.
- Prepare WebRTC-based voice communication.
- Add distance-based audio attenuation.

## 12. Version Control Workflow

The project uses Git and GitHub for collaborative development.

Check the current branch:

```bash
git branch --show-current
```

Check working-tree changes:

```bash
git status
```

After reviewing the changes, commit and push the README from the intended working branch.

```bash
git add README.md
git commit -m "docs: add ProxiSpeak project documentation"
git push origin Naseema
```

## 13. Project Summary

ProxiSpeak aims to create a virtual collaboration environment with real-time avatar movement and proximity-aware communication.

My contribution focuses on database design and position data, including the MongoDB schema, coordinate representation, and preparation for spatial queries. The database integration will be marked complete after the connection, persistence, and relevant queries are implemented and tested.

**Project:** ProxiSpeak — Geospatial Proximity Audio Ecosystem  
**Group:** 33  
**Assignment Code:** ITS/WEB/1322  
**Repository:** [ProxiSpeak on GitHub](https://github.com/revanthofficial21/ProxiSpeak)
