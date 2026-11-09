
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export default function useVoiceChat(socket, position) {
  const [micEnabled, setMicEnabled] = useState(false);
  const [error, setError] = useState("");

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const remoteAudioRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const positionRef = useRef(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const closePeer = useCallback((peerId) => {
    const connection = peerConnectionsRef.current.get(peerId);

    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
      connection.close();

      peerConnectionsRef.current.delete(peerId);
    }

    const audioData = remoteAudioRef.current.get(peerId);

    if (audioData) {
      try {
        audioData.source.disconnect();
        audioData.gain.disconnect();
        audioData.panner.disconnect();
      } catch {
        // Audio nodes may already be disconnected.
      }

      remoteAudioRef.current.delete(peerId);
    }

    pendingIceRef.current.delete(peerId);
  }, []);

  const updateSpatialAudio = useCallback(() => {
    const players = window.__proxyspeakPlayers || [];
    const ownPosition = positionRef.current;

    remoteAudioRef.current.forEach((audioData, peerId) => {
      const remotePlayer = players.find(
        player => player.socketId === peerId
      );

      if (!remotePlayer || !ownPosition) return;

      const distance = Math.hypot(
        remotePlayer.x - ownPosition.x,
        remotePlayer.y - ownPosition.y
      );

      const maximumDistance = 300;
      const normalizedDistance = Math.min(
        distance / maximumDistance,
        1
      );

      audioData.gain.gain.setTargetAtTime(
        Math.max(0, 1 - normalizedDistance),
        audioContextRef.current.currentTime,
        0.1
      );

      audioData.panner.pan.setTargetAtTime(
        Math.max(
          -1,
          Math.min(
            1,
            (remotePlayer.x - ownPosition.x) / maximumDistance
          )
        ),
        audioContextRef.current.currentTime,
        0.1
      );
    });
  }, []);

  const createPeerConnection = useCallback((peerId) => {
    if (peerConnectionsRef.current.has(peerId)) {
      return peerConnectionsRef.current.get(peerId);
    }

    const stream = localStreamRef.current;

    if (!stream) return null;

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    peerConnection.onicecandidate = event => {
      if (event.candidate && socket?.connected) {
        socket.emit("webrtc:ice-candidate", {
          to: peerId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = event => {
      const remoteStream = event.streams[0];

      if (!remoteStream || !audioContextRef.current) return;

      if (remoteAudioRef.current.has(peerId)) return;

      const audioContext = audioContextRef.current;

      const source = audioContext.createMediaStreamSource(
        remoteStream
      );

      const gain = audioContext.createGain();
      const panner = audioContext.createStereoPanner();

      gain.gain.value = 1;
      panner.pan.value = 0;

      source.connect(gain);
      gain.connect(panner);
      panner.connect(audioContext.destination);

      remoteAudioRef.current.set(peerId, {
        source,
        gain,
        panner
      });

      updateSpatialAudio();
    };

    peerConnection.onconnectionstatechange = () => {
      if (
        ["failed", "closed", "disconnected"].includes(
          peerConnection.connectionState
        )
      ) {
        closePeer(peerId);
      }
    };

    peerConnectionsRef.current.set(peerId, peerConnection);

    return peerConnection;
  }, [socket, closePeer, updateSpatialAudio]);

  const processPendingIce = useCallback(async (peerId, connection) => {
    const candidates = pendingIceRef.current.get(peerId) || [];

    pendingIceRef.current.delete(peerId);

    for (const candidate of candidates) {
      try {
        await connection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    }
  }, []);

  const handlePeerRequest = useCallback(async ({ from }) => {
    if (!from || !localStreamRef.current) return;

    try {
      const connection = createPeerConnection(from);

      if (!connection) return;

      const offer = await connection.createOffer();

      await connection.setLocalDescription(offer);

      socket.emit("webrtc:offer", {
        to: from,
        offer: connection.localDescription
      });
    } catch (error) {
      console.error("Offer creation failed:", error);
      setError("Unable to create a voice connection.");
    }
  }, [socket, createPeerConnection]);

  const handleOffer = useCallback(async ({ from, offer }) => {
    if (!from || !offer || !localStreamRef.current) return;

    try {
      const connection = createPeerConnection(from);

      if (!connection) return;

      await connection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      await processPendingIce(from, connection);

      const answer = await connection.createAnswer();

      await connection.setLocalDescription(answer);

      socket.emit("webrtc:answer", {
        to: from,
        answer: connection.localDescription
      });
    } catch (error) {
      console.error("Offer handling failed:", error);
      setError("Unable to accept the voice connection.");
    }
  }, [socket, createPeerConnection, processPendingIce]);

  const handleAnswer = useCallback(async ({ from, answer }) => {
    const connection = peerConnectionsRef.current.get(from);

    if (!connection || !answer) return;

    try {
      await connection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      await processPendingIce(from, connection);
    } catch (error) {
      console.error("Answer handling failed:", error);
    }
  }, [processPendingIce]);

  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    if (!from || !candidate) return;

    const connection = peerConnectionsRef.current.get(from);

    if (!connection || !connection.remoteDescription) {
      const pending = pendingIceRef.current.get(from) || [];
      pending.push(candidate);
      pendingIceRef.current.set(from, pending);
      return;
    }

    try {
      await connection.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      console.error("ICE candidate handling failed:", error);
    }
  }, []);

  const toggleMic = useCallback(async () => {
    if (micEnabled) {
      socket?.emit("voice:leave");

      peerConnectionsRef.current.forEach((connection) => {
        connection.close();
      });

      peerConnectionsRef.current.clear();

      remoteAudioRef.current.forEach(audioData => {
        try {
          audioData.source.disconnect();
          audioData.gain.disconnect();
          audioData.panner.disconnect();
        } catch {
          // Already disconnected.
        }
      });

      remoteAudioRef.current.clear();
      pendingIceRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });

        localStreamRef.current = null;
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      setMicEnabled(false);
      setError("");
      return;
    }

    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access is unavailable. Use localhost or HTTPS."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      localStreamRef.current = stream;

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      audioContextRef.current = new AudioContextClass();

      await audioContextRef.current.resume();

      setMicEnabled(true);

      socket.emit("voice:join");
    } catch (error) {
      console.error("Microphone error:", error);

      setError(
        error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : error.message || "Unable to access the microphone."
      );

      setMicEnabled(false);
    }
  }, [micEnabled, socket]);

  useEffect(() => {
    if (!socket) return;

    socket.on("voice:nearby", players => {
      if (!Array.isArray(players)) return;

      players.forEach(player => {
        if (player.socketId) {
          socket.emit("voice:request-peer", {
            to: player.socketId
          });
        }
      });
    });

    socket.on("voice:peer-request", handlePeerRequest);
    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice-candidate", handleIceCandidate);

    socket.on("voice:peer-left", ({ socketId }) => {
      if (socketId) closePeer(socketId);
    });

    socket.on("proximity:leave", ({ socketId }) => {
      if (socketId) closePeer(socketId);
    });

    const spatialAudioInterval = window.setInterval(
      updateSpatialAudio,
      200
    );

    return () => {
      socket.off("voice:nearby");
      socket.off("voice:peer-request", handlePeerRequest);
      socket.off("webrtc:offer", handleOffer);
      socket.off("webrtc:answer", handleAnswer);
      socket.off("webrtc:ice-candidate", handleIceCandidate);
      socket.off("voice:peer-left");
      socket.off("proximity:leave");

      window.clearInterval(spatialAudioInterval);
    };
  }, [
    socket,
    handlePeerRequest,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeer,
    updateSpatialAudio
  ]);

  useEffect(() => {
    return () => {
      peerConnectionsRef.current.forEach(connection => {
        connection.close();
      });

      peerConnectionsRef.current.clear();

      localStreamRef.current?.getTracks().forEach(track => {
        track.stop();
      });

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    micEnabled,
    toggleMic,
    error
  };
}
