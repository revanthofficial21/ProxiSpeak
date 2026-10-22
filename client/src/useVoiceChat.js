
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function useVoiceChat(socket, nearbyPlayers) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat disabled");

  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const nearbyRef = useRef(nearbyPlayers);

  nearbyRef.current = nearbyPlayers;

  const closePeer = useCallback((peerId, notify = false) => {
    const entry = peersRef.current.get(peerId);

    if (entry) {
      entry.pc.ontrack = null;
      entry.pc.onicecandidate = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      entry.audio.pause();
      entry.audio.srcObject = null;
      peersRef.current.delete(peerId);
    }

    if (notify && socket?.connected) {
      socket.emit("voice:leave", { targetId: peerId });
    }
  }, [socket]);

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
        socket.emit("voice:ice-candidate", {
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
      if (pc.connectionState === "failed" ||
          pc.connectionState === "closed") {
        closePeer(peerId);
      }
    };

    peersRef.current.set(peerId, { pc, audio });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("voice:offer", {
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
        socket.emit("voice:ready", { targetId: player.id });

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
    setVoiceEnabled(false);
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

      closePeer(fromId);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;

      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate && socket.connected) {
          socket.emit("voice:ice-candidate", {
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
        if (pc.connectionState === "failed" ||
            pc.connectionState === "closed") {
          closePeer(fromId);
        }
      };

      peersRef.current.set(fromId, { pc, audio });

      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("voice:answer", {
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
      } catch (error) {
        console.error("Could not set voice answer:", error);
      }
    };

    const onCandidate = async ({ fromId, candidate } = {}) => {
      const entry = peersRef.current.get(fromId);
      if (!entry || !candidate) return;

      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add ICE candidate:", error);
      }
    };

    const onLeave = ({ fromId } = {}) => {
      if (fromId) closePeer(fromId);
    };

    socket.on("voice:ready", onReady);
    socket.on("voice:offer", onOffer);
    socket.on("voice:answer", onAnswer);
    socket.on("voice:ice-candidate", onCandidate);
    socket.on("voice:leave", onLeave);

    return () => {
      socket.off("voice:ready", onReady);
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice-candidate", onCandidate);
      socket.off("voice:leave", onLeave);
    };
  }, [socket, closePeer, createOffer]);

  useEffect(() => {
    const nearbyIds = new Set(nearbyPlayers.map((player) => player.id));

    for (const peerId of peersRef.current.keys()) {
      if (!nearbyIds.has(peerId)) {
        closePeer(peerId, true);
      }
    }

    if (streamRef.current && socket?.connected) {
      nearbyPlayers.forEach((player) => {
        socket.emit("voice:ready", { targetId: player.id });
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
      setVoiceEnabled(false);
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
    };
  }, [socket, closePeer]);

  return {
    voiceEnabled,
    voiceStatus,
    enableVoice,
    disableVoice,
  };
}
