import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const AUDIO_RANGE = 100;

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
  const audioContextRef = useRef(null);
  const audioNodesRef = useRef(new Map());

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

    const nodes = audioNodesRef.current.get(peerId);

    if (nodes) {
      try {
        nodes.source.disconnect();
        nodes.gain.disconnect();
        nodes.panner.disconnect();
      } catch {
        // Nodes may already be disconnected.
      }

      audioNodesRef.current.delete(peerId);
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
        audio.volume = 1;
        audio.muted = mutedRef.current;

        try {
          const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

          if (
            AudioContextClass &&
            !audioNodesRef.current.has(peerId)
          ) {
            const audioContext =
              audioContextRef.current ||
              (audioContextRef.current = new AudioContextClass());

            const source = audioContext.createMediaElementSource(audio);

            const gain = audioContext.createGain();
            gain.gain.value = 0;

            // Week 4: Stereo audio panning.
            const panner = audioContext.createStereoPanner();
            panner.pan.value = 0;

            // Audio flow: Source -> Gain -> Panner -> Speakers.
            source.connect(gain);
            gain.connect(panner);
            panner.connect(audioContext.destination);

            audioNodesRef.current.set(peerId, {
              source,
              gain,
              panner,
            });
          }

          if (audioContextRef.current?.state === "suspended") {
            await audioContextRef.current.resume();
          }

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

      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

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

    audioNodesRef.current.forEach(({ source, gain, panner }) => {
      try {
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
      } catch {
        // Nodes may already be disconnected.
      }
    });

    audioNodesRef.current.clear();

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

    volumeRef.current = numericValue / 100;
    setSpeakerVolume(numericValue);
  }, []);

  const resumeAudio = useCallback(async () => {
    try {
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

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

  // Week 3: Distance-based volume.
  // Week 4: Left/right stereo audio panning.
  useEffect(() => {
    if (!voiceEnabled) return undefined;

    const updateSpatialAudio = () => {
      const players = playersRef?.current;

      if (!players || typeof players.get !== "function") return;

      const localPlayer = players.get(socket?.id);

      if (!localPlayer) return;

      audioNodesRef.current.forEach(({ gain, panner }, peerId) => {
        const remotePlayer = players.get(peerId);

        if (
          !remotePlayer ||
          typeof localPlayer.x !== "number" ||
          typeof localPlayer.y !== "number" ||
          typeof remotePlayer.x !== "number" ||
          typeof remotePlayer.y !== "number"
        ) {
          const now = audioContextRef.current?.currentTime || 0;

          gain.gain.setTargetAtTime(0, now, 0.04);
          panner.pan.setTargetAtTime(0, now, 0.04);
          return;
        }

        const dx = remotePlayer.x - localPlayer.x;
        const dy = remotePlayer.y - localPlayer.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        // Distance-based volume attenuation.
        const distanceGain = Math.max(
          0,
          Math.min(1, 1 - distance / AUDIO_RANGE)
        );

        const targetGain = mutedRef.current
          ? 0
          : volumeRef.current * distanceGain;

        // Horizontal position controls left/right stereo direction.
        const targetPan = Math.max(
          -1,
          Math.min(1, dx / AUDIO_RANGE)
        );

        if (audioContextRef.current) {
          const now = audioContextRef.current.currentTime;

          gain.gain.setTargetAtTime(targetGain, now, 0.04);

          panner.pan.setTargetAtTime(
            targetPan,
            now,
            0.04
          );
        }
      });
    };

    updateSpatialAudio();

    const intervalId = window.setInterval(
      updateSpatialAudio,
      100
    );

    return () => window.clearInterval(intervalId);
  }, [voiceEnabled, socket, playersRef]);

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

      audioNodesRef.current.forEach(({ source, gain, panner }) => {
        try {
          source.disconnect();
          gain.disconnect();
          panner.disconnect();
        } catch {
          // Nodes may already be disconnected.
        }
      });

      audioNodesRef.current.clear();

      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.close();
      }

      audioContextRef.current = null;
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
