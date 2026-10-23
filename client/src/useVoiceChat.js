
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function useVoiceChat(socket, nearbyPlayers) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat disabled");
  const [peerStates, setPeerStates] = useState({});
  const [muted, setMuted] = useState(false);

  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const nearbyRef = useRef(nearbyPlayers);
  const pendingCandidatesRef = useRef(new Map());

  nearbyRef.current = nearbyPlayers;

  const closePeer = useCallback(
    (peerId, notify = false, preserveCandidates = false) => {
      const entry = peersRef.current.get(peerId);
      if (!preserveCandidates) pendingCandidatesRef.current.delete(peerId);

      if (entry) {
        entry.pc.ontrack = null;
        entry.pc.onicecandidate = null;
        entry.pc.onconnectionstatechange = null;
        entry.pc.close();
        entry.audio.pause();
        entry.audio.srcObject = null;
        peersRef.current.delete(peerId);
      }

      setPeerStates((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });

      if (entry && notify && socket?.connected) {
        socket.emit("webrtc:leave", { targetId: peerId });
      }
    },
    [socket]
  );

  const flushCandidates = useCallback(async (peerId, pc) => {
    const candidates = pendingCandidatesRef.current.get(peerId);
    if (!candidates) return;

    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add buffered ICE candidate:", error);
      }
    }
  }, []);

  const createOffer = useCallback(async (peerId) => {
    if (
      !socket?.connected ||
      !streamRef.current ||
      !nearbyRef.current.some((player) => player.id === peerId)
    ) {
      return;
    }

    const current = peersRef.current.get(peerId);
    if (current && current.pc.connectionState !== "closed") return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;

    streamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, streamRef.current);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket.connected) {
        socket.emit("webrtc:ice", {
          targetId: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
      audio.play().catch(() => {
        setVoiceStatus("Voice connected — click to allow audio");
      });
    };

    pc.onconnectionstatechange = () => {
      setPeerStates((current) => ({
        ...current,
        [peerId]: pc.connectionState,
      }));
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        closePeer(peerId);
      }
    };

    peersRef.current.set(peerId, { pc, audio });
    setPeerStates((current) => ({ ...current, [peerId]: pc.connectionState }));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc:offer", {
        targetId: peerId,
        offer: pc.localDescription,
      });
    } catch (error) {
      console.error("Could not create voice offer:", error);
      closePeer(peerId);
    }
  }, [socket, closePeer]);

  const enableVoice = useCallback(async () => {
    if (!socket?.connected) {
      setVoiceStatus("Connect to the server first");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      streamRef.current = stream;
      setVoiceEnabled(true);
      setVoiceStatus("Microphone enabled — waiting for nearby players");

      nearbyRef.current.forEach((player) => {
        socket.emit("webrtc:ready", { targetId: player.id });

        if (socket.id < player.id) {
          createOffer(player.id);
        }
      });
    } catch (error) {
      console.error("Microphone access failed:", error);
      setVoiceStatus(
        error.name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Could not access microphone"
      );
    }
  }, [socket, createOffer]);

  const disableVoice = useCallback(() => {
    for (const peerId of peersRef.current.keys()) {
      closePeer(peerId, true);
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    pendingCandidatesRef.current.clear();
    setVoiceEnabled(false);
    setMuted(false);
    setVoiceStatus("Voice chat disabled");
  }, [closePeer]);

  useEffect(() => {
    if (!socket) return;

    const onReady = ({ fromId } = {}) => {
      if (!fromId || !streamRef.current || socket.id > fromId) return;
      closePeer(fromId);
      createOffer(fromId);
    };

    const onOffer = async ({ fromId, offer } = {}) => {
      if (
        !fromId ||
        !offer ||
        !streamRef.current ||
        !nearbyRef.current.some((player) => player.id === fromId)
      ) {
        return;
      }

      closePeer(fromId, false, true);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;

      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate && socket.connected) {
          socket.emit("webrtc:ice", {
            targetId: fromId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        audio.play().catch(() => {
          setVoiceStatus("Voice connected — click to allow audio");
        });
      };

      pc.onconnectionstatechange = () => {
        setPeerStates((current) => ({
          ...current,
          [fromId]: pc.connectionState,
        }));
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(fromId);
        }
      };

      peersRef.current.set(fromId, { pc, audio });
      setPeerStates((current) => ({
        ...current,
        [fromId]: pc.connectionState,
      }));

      try {
        await pc.setRemoteDescription(offer);
        await flushCandidates(fromId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          targetId: fromId,
          answer: pc.localDescription,
        });
      } catch (error) {
        console.error("Could not answer voice offer:", error);
        closePeer(fromId);
      }
    };

    const onAnswer = async ({ fromId, answer } = {}) => {
      const entry = peersRef.current.get(fromId);
      if (!entry || !answer) return;

      try {
        await entry.pc.setRemoteDescription(answer);
        await flushCandidates(fromId, entry.pc);
      } catch (error) {
        console.error("Could not set voice answer:", error);
      }
    };

    const onCandidate = async ({ fromId, candidate } = {}) => {
      if (!fromId || !candidate) return;
      const entry = peersRef.current.get(fromId);
      if (!entry || !entry.pc.remoteDescription) {
        const queue = pendingCandidatesRef.current.get(fromId) || [];
        queue.push(candidate);
        pendingCandidatesRef.current.set(fromId, queue);
        return;
      }

      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add ICE candidate:", error);
      }
    };

    const onLeave = ({ fromId } = {}) => {
      if (fromId) closePeer(fromId);
    };

    socket.on("webrtc:ready", onReady);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onCandidate);
    socket.on("webrtc:leave", onLeave);

    return () => {
      socket.off("webrtc:ready", onReady);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onCandidate);
      socket.off("webrtc:leave", onLeave);
    };
  }, [socket, closePeer, createOffer, flushCandidates]);

  useEffect(() => {
    const nearbyIds = new Set(nearbyPlayers.map((player) => player.id));

    for (const peerId of peersRef.current.keys()) {
      if (!nearbyIds.has(peerId)) {
        closePeer(peerId, true);
      }
    }

    if (streamRef.current && socket?.connected) {
      nearbyPlayers.forEach((player) => {
        socket.emit("webrtc:ready", { targetId: player.id });
      });
    }
  }, [nearbyPlayers, socket, closePeer]);

  useEffect(() => {
    const onDisconnect = () => {
      for (const peerId of peersRef.current.keys()) {
        closePeer(peerId);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      pendingCandidatesRef.current.clear();
      setPeerStates({});
      setVoiceEnabled(false);
      setMuted(false);
      setVoiceStatus("Server disconnected");
    };

    socket?.on("disconnect", onDisconnect);

    return () => {
      socket?.off("disconnect", onDisconnect);
      for (const peerId of peersRef.current.keys()) {
        closePeer(peerId);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      pendingCandidatesRef.current.clear();
      setPeerStates({});
    };
  }, [socket, closePeer]);

  // Toggle the local microphone without dropping any peer connections.
  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }, [muted]);

  return {
    voiceEnabled,
    voiceStatus,
    peerStates,
    muted,
    enableVoice,
    disableVoice,
    toggleMute,
  };
}
