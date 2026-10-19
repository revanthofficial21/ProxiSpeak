# ProxiSpeak — Geospatial Proximity Audio Ecosystem

**A real-time virtual collaboration environment built with React, Node.js, Express, and Socket.IO.**

Repository: [ProxiSpeak on GitHub](https://github.com/revanthofficial21/ProxiSpeak)

## 1. Project Overview

ProxiSpeak is a full-stack web application designed to bring spatial interaction into remote collaboration. Users are represented by avatars in a shared 2D virtual world, where their movement and presence are synchronized between connected browser clients.

The project combines frontend canvas rendering with backend real-time communication. Its intended direction is to support proximity-aware conversations, where audio interactions depend on the distance between participants.

Our current development work focuses on establishing the application structure, creating the virtual-world interface, implementing avatar movement, and connecting the frontend to a Socket.IO backend.

## 2. Problem Statement

Traditional remote collaboration tools often rely on scheduled meetings and manually initiated conversations. They do not naturally reproduce the experience of moving through a shared physical environment and interacting with people nearby.

ProxiSpeak addresses this problem by introducing a virtual environment in which participants can move around, observe other participants, and share a synchronized world.

## 3. Project Objectives

- Create a shared 2D virtual world using React and the Canvas API.
- Implement keyboard-controlled avatar movement.
- Synchronize player coordinates between connected browser clients.
- Manage player connections and disconnections in real time.
- Establish a modular frontend and backend architecture.
- Prepare the project for spatial data handling and proximity-based audio communication.

## 4. Team Details and Responsibilities

ProxiSpeak is being developed by a team of four members, with each member responsible for a specific module of the project.

### Team Members

| Team Member | Role | Responsibilities |
|---|---|---|
| **Revanth (Project Lead)** | Backend Developer & Integration | Build the working server, implement Socket.IO communication, broadcast avatar positions in real time, and integrate frontend and backend modules. |
| **Vivek** | Frontend Developer | Develop the virtual office using React and Canvas, implement avatar rendering, and build smooth avatar movement controls. |
| **Janakirani Venkatesan** | WebRTC Research & Testing | Research WebRTC, prepare the foundation for voice communication, and conduct browser testing without delaying movement development. |
| **Naseema** | Database Developer | Design the MongoDB data model for virtual-world positions and prepare the position-data storage approach. |

### Individual Responsibilities

**1. Revanth — Backend Development & Integration**
- Set up the Node.js and Express backend.
- Configure the HTTP server and Socket.IO.
- Handle player connections and disconnections.
- Receive avatar movement coordinates from frontend clients.
- Validate coordinates and keep them within the virtual-world boundaries.
- Broadcast updated avatar positions to connected clients.
- Integrate the frontend and backend and coordinate module integration.

**2. Vivek — Frontend Development**
- Build the virtual office interface using React.
- Implement the Canvas-based world and avatar rendering.
- Develop keyboard-based avatar movement.
- Maintain the frontend representation of connected players.
- Integrate movement controls with the backend's real-time events.

**3. Janakirani Venkatesan — WebRTC Research & Testing**
- Research WebRTC architecture and browser support.
- Prepare the technical foundation for future voice communication.
- Investigate the requirements for real-time audio connections.
- Test the application across browser windows.
- Support integration testing while keeping the movement-development milestone on schedule.

**4. Naseema — Database Development**
- Design the MongoDB schema for virtual-world position data.
- Define how player identifiers and X/Y coordinates should be represented.
- Plan the storage structure for player-position information.
- Prepare for future spatial queries and proximity calculations.
- Coordinate the data model with the backend's movement-event structure.

### Team Integration Workflow

1. **Frontend:** Vivek develops the virtual office and avatar movement controls.
2. **Backend:** Revanth implements the real-time server and movement-broadcasting events.
3. **Database:** Naseema designs the position-data model to align with the backend.
4. **WebRTC research and testing:** Janakirani Venkatesan investigates voice communication and supports browser testing independently of the movement work.
5. **Integration:** The team connects the modules, tests movement synchronization, and prepares the foundation for subsequent development.

### Team's Week 1 Deliverable

The primary deliverable is a working real-time movement foundation: a React-based virtual office connected to a backend that receives and broadcasts avatar positions to connected clients.

The database design and WebRTC research proceed alongside this work so that they can be integrated in later development stages.

## 5. Technology Stack

| Technology | Usage in ProxiSpeak |
|---|---|
| React | Building the frontend interface |
| Vite | Frontend development server and tooling |
| JavaScript | Frontend and backend application logic |
| HTML Canvas API | Rendering the virtual world and avatars |
| CSS | Styling the application interface |
| Node.js | Running the backend |
| Express.js | HTTP server and health endpoint |
| Socket.IO | Real-time client-server communication |
| MongoDB | Planned spatial data storage and querying |
| WebRTC | Planned real-time voice communication |
| Git | Source-code version control |
| GitHub | Repository hosting and team collaboration |
| Visual Studio Code | Development environment |

## 6. System Architecture

ProxiSpeak follows a client-server architecture. Each browser runs the React application, while a shared Node.js server manages player connections and distributes movement updates.

```text
                PROXISPEAK ARCHITECTURE

       +------------------+  +------------------+
       |   Browser A      |  |   Browser B      |
       |                  |  |                  |
       | React Interface  |  | React Interface  |
       | Canvas World     |  | Canvas World     |
       | Avatar Movement  |  | Avatar Movement  |
       +--------+---------+  +---------+--------+
                |                      |
                +----------+-----------+
                           |
                     Socket.IO
                           |
                           v
              +-------------------------+
              |     Node.js Server      |
              |                         |
              |     Express HTTP        |
              |     Socket.IO Server    |
              |                         |
              |  Player Connections    |
              |  Movement Validation  |
              |  Player State         |
              |  Position Broadcasting|
              +------------+------------+
                           |
                           v
              +-------------------------+
              |   MongoDB Integration   |
              |   Spatial Data (Planned)|
              +-------------------------+

              WebRTC Audio (Planned)
```

### Frontend layer

The frontend provides the virtual environment and user interaction. React manages the application interface and player state, while the Canvas API renders the world and avatars.

The frontend sends movement coordinates to the backend through Socket.IO and receives updates for connected participants.

### Backend layer

The backend uses Express with Node.js and an HTTP server integrated with Socket.IO.

Its current responsibilities include:

- Accepting Socket.IO connections.
- Assigning socket IDs to connected players.
- Creating an initial player position.
- Maintaining connected-player state in memory.
- Receiving and validating movement coordinates.
- Keeping coordinates inside the virtual-world boundaries.
- Broadcasting movement updates.
- Informing connected clients when a player joins or leaves.
- Providing an HTTP health endpoint.

### Data and communication layer

The initial implementation uses in-memory player tracking. MongoDB is part of the planned architecture for persistence and spatial queries. WebRTC is intended for the subsequent real-time audio functionality.

## 7. Project Structure

The repository contains separate frontend and backend applications.

```text
ProxiSpeak/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── index.css
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.js
│
├── server/
│   ├── index.js
│   ├── package.json
│   └── package-lock.json
│
├── docs/
├── .gitignore
└── README.md
```

## 8. Implementation Completed

### 8.1 Frontend setup

- Created the React application using Vite.
- Organized the frontend under the `client` directory.
- Set up the main application component and CSS files.
- Prepared a canvas-based virtual world.
- Added the frontend Socket.IO client dependency.

### 8.2 Virtual-world interface

- Established the 2D world-rendering approach using the Canvas API.
- Defined virtual-world dimensions of 1000 × 600.
- Added avatar rendering and a grid-based world background.
- Prepared keyboard controls using WASD and arrow keys.
- Designed a dark-themed application interface with player and connection information.

### 8.3 Backend setup

- Created the Node.js backend under the `server` directory.
- Configured Express and the HTTP server.
- Integrated Socket.IO with the HTTP server.
- Configured the development frontend origin, `http://localhost:5173`.
- Added a default backend port of `3000`.
- Added a health endpoint at `/`.
- Configured development scripts for starting the server.

### 8.4 Player management

- Created an in-memory `Map` to track connected players.
- Used each Socket.IO connection ID as the player identifier.
- Assigned an initial player position of `(100, 100)`.
- Added initial world-state delivery to newly connected clients.
- Added player-join notifications for existing clients.
- Added player-removal handling when a client disconnects.

### 8.5 Movement synchronization

- Implemented the `player:move` event for incoming coordinate updates.
- Validated that incoming X and Y values are finite numbers.
- Constrained coordinates to the world boundaries.
- Updated the stored player position.
- Broadcast the validated position through the `player:moved` event.

### 8.6 Frontend-backend integration

- Connected the frontend to the backend at `http://localhost:3000`.
- Configured Socket.IO event handling for world state and player presence.
- Connected the frontend movement workflow to backend coordinate broadcasting.
- Started the frontend and backend using separate development terminals.
- Investigated and resolved the initial backend connection-refused issue by getting the backend service running.

### Real-Time Communication Events
| Event | Purpose |
|---|---|
| `world:state` | Sends the current world state to a newly connected player |
| `player:joined` | Notifies other users when a player joins |
| `player:move` | Receives avatar movement updates from a client |
| `player:moved` | Broadcasts updated avatar coordinates |
| `player:left` | Notifies other users when a player disconnects |

### Backend Integration
- Integrated Express.js with an HTTP server and Socket.IO.
- Configured Cross-Origin Resource Sharing (CORS) for local frontend connectivity.
- Connected the backend to the existing MongoDB database module for player-position persistence.
- Configured environment variables for backend settings and database connectivity.
- Tested the backend and pushed the completed changes to my GitHub branch.

### Project Leadership
- Coordinated backend integration with the frontend and database workstreams.
- Supported team collaboration through Git branches and GitHub.
- Focused on maintaining a working real-time movement system for subsequent feature integration.

### Current Deliverable
A working backend that supports player connections, avatar-coordinate updates, real-time position broadcasting, and player disconnection handling.

**Technologies:** Node.js · Express.js · Socket.IO · MongoDB · JavaScript · Git · GitHub