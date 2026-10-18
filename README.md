# ProxiSpeak
# ProxiSpeak

## ProxiSpeak – Geospatial Proximity Audio Ecosystem

ProxiSpeak is a location-based audio ecosystem designed to enable real-time interaction between users based on their proximity in a virtual environment.

### Project Objectives
- Create a virtual environment with movable avatars.
- Track avatar positions in real time.
- Identify nearby users based on distance.
- Support proximity-based audio communication.

### Technology Stack
- **Frontend:** React.js, HTML, CSS, JavaScript, Canvas
- **Backend:** Node.js, Express.js
- **Real-Time Communication:** Socket.IO
- **Database:** MongoDB
- **Audio Communication:** WebRTC and Web Audio API

### Project Structure
- `client/` – Frontend application
- `server/` – Backend application
- `server/index.js` – Backend server

### Current Progress
- Backend server setup
- Express.js and Socket.IO configuration
- Real-time avatar movement broadcasting
- MongoDB connection setup in progress

### How to Run the Backend
1. Open the terminal in the project folder.
2. Navigate to the server directory:

   `cd server`

3. Install dependencies:

   `npm install`

4. Configure the MongoDB connection string in `server/.env`:

   `MONGODB_URI=your_mongodb_connection_string`

5. Start the development server:

   `npm run dev`

The backend uses port `3000` by default.

### Project Information
- **Group:** 33
- **Assignment Code:** ITS/WEB/1322

### Development Status
This project is currently under development. Features and integrations will be updated as the project progresses.