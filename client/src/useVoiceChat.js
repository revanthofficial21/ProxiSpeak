```javascript
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function useVoiceChat(socket, nearbyPlayers, playersRef) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState(
    "Microphone disabled. Enable it to start voice chat."
  );
  const [peerStates, setPeerStates] = useState({});
  const [muted, setMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(100);
  const [audioOutputBlocked, setAudioOutputBlocked] = useState(false);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const enabledRef = useRef(false);
  const mutedRef = useRef(false);
  const volumeRef = useRef(1);

  const updatePeerState = useCallback((peerId, state) => {
    setPeerStates((previous) => ({
      ...previous,
      [peerId]: state,
    }));
  }, []);

  const closePeer = useCallback((peerId) => {
    const connection = peerConnectionsRef.current.get(peerId);

    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onconnectionstatechange = null;
      connection.close();
      peerConnectionsRef.current.delete(peerId);
    }

    const audio = audioElementsRef.current.get(peerId);

    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audioElementsRef.current.delete(peerId);
    }

    setPeerStates((previous) => {
      const next = { ...previous };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId) => {
      const existing = peerConnectionsRef.current.get(peerId);

      if (existing) return existing;

      const connection = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionsRef.current.set(peerId, connection);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          connection.addTrack(track, localStreamRef.current);
        });
      }

      connection.onicecandidate = (event) => {
        if (event.candidate && socket?.connected) {
          socket.emit("webrtc:ice-candidate", {
            to: peerId,
            candidate: event.candidate,
          });
        }
      };

      connection.ontrack = async (event) => {
        let audio = audioElementsRef.current.get(peerId);

        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.playsInline = true;
          audioElementsRef.current.set(peerId, audio);
        }

        audio.srcObject = event.streams[0];
        audio.volume = volumeRef.current;
        audio.muted = mutedRef.current;

        try {
          await audio.play();
          setAudioOutputBlocked(false);
        } catch {
          setAudioOutputBlocked(true);
        }

        updatePeerState(peerId, "Voice connected");
      };

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;

        updatePeerState(peerId, state);

        if (state === "failed" || state === "closed") {
          closePeer(peerId);
        }
      };

      return connection;
    },
    [socket, updatePeerState, closePeer]
  );

  const enableVoice = useCallback(async () => {
    if (enabledRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus(
        "Microphone access is unavailable. Use HTTPS or localhost."
      );
      return;
    }

    try {
      setVoiceStatus("Requesting microphone permission...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      enabledRef.current = true;
      setVoiceEnabled(true);
      setVoiceStatus("Microphone enabled. Waiting for nearby players.");

      if (socket?.connected) {
        socket.emit("voice:join");
      }
    } catch (error) {
      setVoiceStatus(
        error?.name === "NotAllowedError"
          ? "Microphone permission denied. Allow microphone access in your browser."
          : "Could not start microphone. Check your device and browser permissions."
      );
    }
  }, [socket]);

  const disableVoice = useCallback(() => {
    enabledRef.current = false;

    peerConnectionsRef.current.forEach((connection) => {
      connection.close();
    });

    peerConnectionsRef.current.clear();

    audioElementsRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });

    audioElementsRef.current.clear();

    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStreamRef.current = null;

    if (socket?.connected) {
      socket.emit("voice:leave");
    }

    setVoiceEnabled(false);
    setPeerStates({});
    setAudioOutputBlocked(false);
    setVoiceStatus("Microphone disabled.");
  }, [socket]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    audioElementsRef.current.forEach((audio) => {
      audio.muted = nextMuted;
    });
  }, []);

  const changeSpeakerVolume = useCallback((value) => {
    const numericValue = Math.max(
      0,
      Math.min(100, Number(value) || 0)
    );

    const volume = numericValue / 100;
    volumeRef.current = volume;
    setSpeakerVolume(numericValue);

    audioElementsRef.current.forEach((audio) => {
      audio.volume = volume;
    });
  }, []);

  const resumeAudio = useCallback(async () => {
    try {
      for (const audio of audioElementsRef.current.values()) {
        await audio.play();
      }

      setAudioOutputBlocked(false);
    } catch {
      setAudioOutputBlocked(true);
    }
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const handleOffer = async ({ from, offer }) => {
      if (!enabledRef.current || !from || !offer) return;

      try {
        const connection = createPeerConnection(from);

        await connection.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          to: from,
          answer,
        });

        updatePeerState(from, "Answer sent");
      } catch {
        updatePeerState(from, "Offer handling failed");
      }
    };

    const handleAnswer = async ({ from, answer }) => {
      const connection = peerConnectionsRef.current.get(from);

      if (!connection || !answer) return;

      try {
        await connection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );

        updatePeerState(from, "Answer received");
      } catch {
        updatePeerState(from, "Answer handling failed");
      }
    };

    const handleCandidate = async ({ from, candidate }) => {
      const connection = peerConnectionsRef.current.get(from);

      if (!connection || !candidate) return;

      try {
        await connection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch {
        updatePeerState(from, "ICE candidate failed");
      }
    };

    const handleVoicePeer = async ({ peerId }) => {
      if (
        !enabledRef.current ||
        !peerId ||
        peerId === socket.id ||
        peerConnectionsRef.current.has(peerId)
      ) {
        return;
      }

      try {
        const connection = createPeerConnection(peerId);
        const offer = await connection.createOffer();

        await connection.setLocalDescription(offer);

        socket.emit("webrtc:offer", {
          to: peerId,
          offer,
        });

        updatePeerState(peerId, "Offer sent");
      } catch {
        updatePeerState(peerId, "Could not create offer");
      }
    };

    const handlePeerLeft = ({ peerId }) => {
      if (peerId) closePeer(peerId);
    };

    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice-candidate", handleCandidate);
    socket.on("voice:peer", handleVoicePeer);
    socket.on("voice:peer-left", handlePeerLeft);

    return () => {
      socket.off("webrtc:offer", handleOffer);
      socket.off("webrtc:answer", handleAnswer);
      socket.off("webrtc:ice-candidate", handleCandidate);
      socket.off("voice:peer", handleVoicePeer);
      socket.off("voice:peer-left", handlePeerLeft);
    };
  }, [socket, createPeerConnection, updatePeerState, closePeer]);

  useEffect(() => {
    if (!voiceEnabled || !socket?.connected) return;

    nearbyPlayers.forEach((player) => {
      if (
        player?.id &&
        player.id !== socket.id &&
        !peerConnectionsRef.current.has(player.id)
      ) {
        socket.emit("voice:request-peer", {
          peerId: player.id,
        });
      }
    });
  }, [nearbyPlayers, voiceEnabled, socket]);

  useEffect(() => {
    return () => {
      enabledRef.current = false;

      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      peerConnectionsRef.current.forEach((connection) => {
        connection.close();
      });

      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
      });

      peerConnectionsRef.current.clear();
      audioElementsRef.current.clear();
    };
  }, []);

  return {
    voiceEnabled,
    voiceStatus,
    peerStates,
    muted,
    speakerVolume,
    audioOutputBlocked,
    enableVoice,
    disableVoice,
    toggleMute,
    changeSpeakerVolume,
    resumeAudio,
  };
}
```
