# ProxiSpeak 🎙️

ProxiSpeak is a real-time multiplayer application designed to enable communication between nearby players through proximity-based voice chat.

## ✨ Features

- Real-time multiplayer support
- Nearby-player detection
- Proximity-based voice communication
- Microphone enable and disable controls
- Real-time event handling using Socket.IO
- WebRTC-based audio communication

## 🛠️ Tech Stack

- **Frontend:** React, Vite
- **Backend:** Node.js, Express.js
- **Real-Time Communication:** Socket.IO
- **Voice Communication:** WebRTC
- **Database:** MongoDB

## 📁 Project Structure

```text
ProxiSpeak/
├── client/     # React frontend
├── server/     # Node.js backend
└── README.md
```

## 🚀 Getting Started

### Prerequisites

Install Node.js and npm before running the application.

### 1. Clone the Repository

```bash
git clone https://github.com/revanthofficial21/ProxiSpeak.git
cd ProxiSpeak
```

### 2. Start the Backend

```bash
cd server
npm install
```

Configure the required environment variables in a `.env` file. For example:

```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
```

Use your own MongoDB connection string if database persistence is required. Never commit passwords, API keys, or other secrets.

Start the backend:

```bash
npm start
```

### 3. Start the Frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Open the local URL displayed by Vite in your browser.

## 🎤 Testing Proximity Voice Chat

1. Start both the backend and frontend.
2. Open the application in two browser sessions.
3. Connect as two different players.
4. Allow microphone access and click **Enable Microphone**.
5. Move the players close to each other to test voice communication.
6. Move them apart to verify that proximity-based audio stops.
7. Move them close again to test reconnection.

**Note:** Microphone permissions and network connectivity are required for voice communication. WebRTC connections may require additional network configuration in some environments.

## 📌 Project Status

The proximity voice chat feature has been implemented and tested in the development environment. Further integration testing and team review may be required.

## 🤝 Contributing

Contributions, suggestions, and bug reports are welcome. Please follow the project's branch and pull request workflow when submitting changes.
