# ProxiSpeak — Geospatial Proximity Audio Ecosystem

ProxiSpeak is a real-time virtual collaboration environment designed to connect users through avatar movement and proximity-aware audio.

**Technology Stack:** React, Node.js, Express.js, Socket.IO, MongoDB, WebRTC

## 1. Project Overview

ProxiSpeak is a full-stack web application designed to create a shared 2D virtual environment where users are represented by avatars. The application synchronizes avatar positions between connected browser clients and provides a foundation for proximity-based audio communication.

The project combines a React-based frontend, a Node.js backend, real-time communication through Socket.IO, and MongoDB for player data and position storage.

## 2. Problem Statement

Traditional remote collaboration tools do not naturally recreate the experience of moving through a shared environment and interacting with nearby participants.

ProxiSpeak aims to address this limitation by providing a virtual space where users can move around, observe other participants, and eventually communicate through distance-aware audio interactions.

## 3. Project Objectives

- Develop a shared 2D virtual environment.
- Synchronize avatar positions between connected clients.
- Manage player connections and disconnections in real time.
- Store player information and avatar position data.
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

My responsibility is database development, focusing on MongoDB and virtual-world position data.

Key responsibilities:

- Design a MongoDB data model for player information and avatar coordinates.
- Define how player identifiers and X/Y coordinates are represented.
- Plan the storage structure for player-position information.
- Coordinate database integration with the backend.
- Support reliable storage and retrieval of player data.

## 5. Project Structure

- `client/` — Frontend application
- `server/` — Backend application
- `server/index.js` — Backend server

## 6. Current Progress

- Backend server setup.
- Express.js and Socket.IO configuration.
- Real-time player connection and movement handling.
- MongoDB connection and player data integration.

## 7. How to Run the Backend

1. Open a terminal in the project folder.
2. Navigate to the server directory:

   `cd server`

3. Install dependencies:

   `npm install`

4. Configure the MongoDB connection string in `server/.env`:

   `MONGODB_URI=your_mongodb_connection_string`

5. Start the backend:

   `npm run dev`

The backend uses port `3000` by default.

## 8. Project Information

- **Group:** 33
- **Assignment Code:** ITS/WEB/1322

## 9. Development Status

ProxiSpeak is currently under development. Additional features and integrations will be implemented as the project progresses.
