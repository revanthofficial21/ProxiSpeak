
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

// Spatial audio: peers fade out with distance and pan by relative position.
const PROXIMITY_RADIUS = 100;
const MAX_GAIN = 1;

export default function useVoiceChat(socket, nearbyPlayers, positionsRef) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat disabled");
  const [peerStates, setPeerStates] = useState({});
  const [muted, setMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(100);
  const [audioOutputBlocked, setAudioOutputBlocked] = useState(false);

  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const nearbyRef = useRef(nearbyPlayers);
  const pendingCandidatesRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const mixerRef = useRef(new Map()); // peerId -> { source, gain, panner }
  const speakerVolumeRef = useRef(1); // master volume, 0..1
  const blockedRef = useRef(false);

  useEffect(() => {
    nearbyRef.current = nearbyPlayers;
  }, [nearbyPlayers]);

  // Create (and resume) the shared AudioContext. Browsers start it suspended,
  // so this is called from the enableVoice click (a user gesture).
  const ensureAudioContext = useCallback(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new Ctx();
      audioContextRef.current.onstatechange = () => {
        setAudioOutputBlocked(audioContextRef.current.state !== "running");
      };
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
    setAudioOutputBlocked(audioContextRef.current.state !== "running");
    return audioContextRef.current;
  }, []);

  const detachMixer = useCallback((peerId) => {
    const nodes = mixerRef.current.get(peerId);
    if (!nodes) return;

    try {
      nodes.source.disconnect();
    } catch (error) {
      // already disconnected
    }
    try {
      nodes.gain.disconnect();
    } catch (error) {
      // already disconnected
    }
    if (nodes.panner) {
      try {
        nodes.panner.disconnect();
      } catch (error) {
        // already disconnected
      }
    }
    mixerRef.current.delete(peerId);
  }, []);

  // Route a remote stream through gain -> stereo panner -> speakers.
  const attachRemoteStream = useCallback(
    (peerId, stream) => {
      const ctx = ensureAudioContext();
      if (!ctx) return;

      detachMixer(peerId);

      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 0; // silent until the mixer sets it by distance

      source.connect(gain);

      let panner = null;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        gain.connect(panner);
        panner.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      mixerRef.current.set(peerId, { source, gain, panner });
    },
    [ensureAudioContext, detachMixer]
  );

  const closePeer = useCallback(
    (peerId, notify = false, preserveCandidates = false) => {
      const entry = peersRef.current.get(peerId);
      if (!preserveCandidates) pendingCandidatesRef.current.delete(peerId);

      if (entry) {
        entry.pc.ontrack = null;
        entry.pc.onicecandidate = null;
        entry.pc.onconnectionstatechange = null;
        entry.pc.close();
        peersRef.current.delete(peerId);
      }

      detachMixer(peerId);

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
    [socket, detachMixer]
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
      attachRemoteStream(peerId, event.streams[0]);
      setVoiceStatus("Voice connected");
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

    peersRef.current.set(peerId, { pc });
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
  }, [socket, closePeer, attachRemoteStream]);

  const enableVoice = useCallback(async () => {
    if (!socket?.connected) {
      setVoiceStatus("Connect to the server first");
      return;
    }

    // Create/resume the AudioContext synchronously, while we still hold the
    // user gesture. Creating it after the getUserMedia await loses the
    // gesture, so the browser leaves it suspended and audio stays silent.
    ensureAudioContext();

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
  }, [socket, createOffer, ensureAudioContext]);

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

      // Already connected? Don't tear it down and renegotiate.
      const existing = peersRef.current.get(fromId);
      if (existing && existing.pc.connectionState === "connected") return;

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
        attachRemoteStream(fromId, event.streams[0]);
        setVoiceStatus("Voice connected");
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

      peersRef.current.set(fromId, { pc });
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
  }, [socket, closePeer, createOffer, flushCandidates, attachRemoteStream]);

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

  // Spatial mixer: every frame, set each peer's gain and stereo pan from the
  // live avatar positions — volume falls off with distance, pan follows the
  // peer's left/right offset from the local player.
  useEffect(() => {
    let frame;

    const mix = () => {
      const ctx = audioContextRef.current;

      // If the browser suspended us (autoplay policy), try to resume, and
      // surface it so the UI can offer a "Resume audio" control. Only setState
      // when it actually changes — this runs every animation frame.
      if (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const blocked = ctx.state !== "running";
        if (blocked !== blockedRef.current) {
          blockedRef.current = blocked;
          setAudioOutputBlocked(blocked);
        }
      }

      const positions = positionsRef?.current;
      const me = socket?.id;

      if (ctx && positions && me && mixerRef.current.size > 0) {
        const local = positions.get(me);

        if (local) {
          const now = ctx.currentTime;

          for (const [peerId, nodes] of mixerRef.current.entries()) {
            const peer = positions.get(peerId);
            if (!peer || !Number.isFinite(peer.x) || !Number.isFinite(peer.y)) {
              continue;
            }

            const dx = peer.x - local.x;
            const dy = peer.y - local.y;
            const distance = Math.hypot(dx, dy);

            // Linear fall-off: full volume at 0px, silent at the radius edge,
            // scaled by the user's master speaker volume.
            const targetGain =
              MAX_GAIN *
              speakerVolumeRef.current *
              Math.max(0, Math.min(1, 1 - distance / PROXIMITY_RADIUS));

            // setTargetAtTime smooths the change, avoiding zipper clicks.
            nodes.gain.gain.setTargetAtTime(targetGain, now, 0.05);

            if (nodes.panner) {
              const targetPan = Math.max(
                -1,
                Math.min(1, dx / PROXIMITY_RADIUS)
              );
              nodes.panner.pan.setTargetAtTime(targetPan, now, 0.05);
            }
          }
        }
      }

      frame = requestAnimationFrame(mix);
    };

    frame = requestAnimationFrame(mix);
    return () => cancelAnimationFrame(frame);
  }, [socket, positionsRef]);

  const changeSpeakerVolume = useCallback((value) => {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    speakerVolumeRef.current = clamped / 100;
    setSpeakerVolume(clamped);
  }, []);

  const resumeAudio = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    try {
      if (ctx.state !== "running") await ctx.resume();
      setAudioOutputBlocked(ctx.state !== "running");
    } catch (error) {
      console.error("Could not resume audio output:", error);
    }
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
