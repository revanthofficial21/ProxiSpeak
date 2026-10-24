
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function useVoiceChat(
  socket,
  nearbyPlayers,
  getLocalPlayerPosition
) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(100);
  const [audioOutputBlocked, setAudioOutputBlocked] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat disabled");
  const [peerStates, setPeerStates] = useState({});

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const peersRef = useRef(new Map());
  const nearbyRef = useRef(nearbyPlayers);
  const pendingCandidatesRef = useRef(new Map());
  const mutedRef = useRef(false);
  const speakerVolumeRef = useRef(1);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      if (!window.AudioContext) {
        throw new Error("Web Audio is not supported in this browser");
      }

      const context = new window.AudioContext();
      context.onstatechange = () => {
        setAudioOutputBlocked(context.state !== "running");
      };
      audioContextRef.current = context;
      setAudioOutputBlocked(context.state !== "running");
    }

    return audioContextRef.current;
  }, []);

  const resumeAudio = useCallback(async () => {
    const context = audioContextRef.current;
    if (!context) return;

    try {
      if (context.state !== "running") await context.resume();
      const blocked = context.state !== "running";
      setAudioOutputBlocked(blocked);
      if (blocked) {
        setVoiceStatus("Audio is paused — select Resume audio to hear players");
      }
    } catch (error) {
      console.error("Could not resume audio output:", error);
      setAudioOutputBlocked(true);
      setVoiceStatus("Audio is paused — select Resume audio to hear players");
    }
  }, []);

  const updateSpatialAudio = useCallback(() => {
    const localPlayer = getLocalPlayerPosition();

    for (const [peerId, entry] of peersRef.current) {
      if (!entry.gain) continue;

      const remotePlayer = nearbyRef.current.find(
        (player) => player.id === peerId
      );
      const hasPositions =
        localPlayer &&
        remotePlayer &&
        Number.isFinite(localPlayer.x) &&
        Number.isFinite(localPlayer.y) &&
        Number.isFinite(remotePlayer.x) &&
        Number.isFinite(remotePlayer.y);
      const deltaX = hasPositions ? remotePlayer.x - localPlayer.x : 0;
      const deltaY = hasPositions ? remotePlayer.y - localPlayer.y : 0;
      const distance = hasPositions ? Math.hypot(deltaX, deltaY) : 100;
      const spatialGain = Math.max(0, 1 - distance / 100);
      const targetGain = spatialGain * speakerVolumeRef.current;
      const targetPan = Math.max(-1, Math.min(1, deltaX / 100));
      const currentTime = entry.gain.context.currentTime;

      if (Math.abs((entry.targetGain ?? -1) - targetGain) >= 0.001) {
        entry.gain.gain.setTargetAtTime(targetGain, currentTime, 0.08);
        entry.targetGain = targetGain;
      }
      if (
        entry.panner &&
        Math.abs((entry.targetPan ?? 2) - targetPan) >= 0.01
      ) {
        entry.panner.pan.setTargetAtTime(targetPan, currentTime, 0.08);
        entry.targetPan = targetPan;
      }
    }
  }, [getLocalPlayerPosition]);

  const connectRemoteAudio = useCallback(
    (peerId, stream) => {
      const entry = peersRef.current.get(peerId);
      const context = audioContextRef.current;
      if (!entry || !context) return;

      entry.source?.disconnect();
      entry.gain?.disconnect();
      entry.panner?.disconnect();

      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const panner = context.createStereoPanner
        ? context.createStereoPanner()
        : null;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(gain);
      if (panner) {
        gain.connect(panner);
        panner.connect(context.destination);
      } else {
        gain.connect(context.destination);
      }

      entry.source = source;
      entry.gain = gain;
      entry.panner = panner;
      entry.targetGain = -1;
      entry.targetPan = 2;
      setAudioOutputBlocked(context.state !== "running");
      updateSpatialAudio();
    },
    [updateSpatialAudio]
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
        entry.source?.disconnect();
        entry.gain?.disconnect();
        entry.panner?.disconnect();
        peersRef.current.delete(peerId);
      }

      setPeerStates((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });

      if (entry && notify && socket?.connected) {
        socket.emit("voice:leave", { targetId: peerId });
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
      const remoteStream =
        event.streams[0] || new MediaStream([event.track]);
      connectRemoteAudio(peerId, remoteStream);
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

      socket.emit("voice:offer", {
        targetId: peerId,
        offer: pc.localDescription,
      });
    } catch (error) {
      console.error("Could not create voice offer:", error);
      closePeer(peerId);
    }
  }, [socket, closePeer, connectRemoteAudio]);

  const enableVoice = useCallback(async () => {
    if (!socket?.connected) {
      setVoiceStatus("Connect to the server first");
      return;
    }

    let audioContext;
    try {
      audioContext = getAudioContext();
    } catch (error) {
      console.error("Audio output initialization failed:", error);
      setVoiceStatus(error.message);
      return;
    }
    const audioResume = resumeAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      await audioResume;

      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      mutedRef.current = false;
      setMuted(false);
      setVoiceEnabled(true);
      setVoiceStatus(
        audioContext.state === "running"
          ? "Microphone enabled — waiting for nearby players"
          : "Audio is paused — select Resume audio to hear players"
      );

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
  }, [socket, createOffer, getAudioContext, resumeAudio]);

  const disableVoice = useCallback(() => {
    for (const peerId of peersRef.current.keys()) {
      closePeer(peerId, true);
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    pendingCandidatesRef.current.clear();
    mutedRef.current = false;
    setMuted(false);
    setVoiceEnabled(false);
    setVoiceStatus("Voice chat disabled");
  }, [closePeer]);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const nextMuted = !mutedRef.current;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
  }, []);

  const updateSpeakerVolume = useCallback((value) => {
    const nextVolume = Number(value);
    if (!Number.isFinite(nextVolume)) return;

    const clampedVolume = Math.min(100, Math.max(0, nextVolume));
    speakerVolumeRef.current = clampedVolume / 100;
    setSpeakerVolume(clampedVolume);
    updateSpatialAudio();
  }, [updateSpatialAudio]);

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
        const remoteStream =
          event.streams[0] || new MediaStream([event.track]);
        connectRemoteAudio(fromId, remoteStream);
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
  }, [socket, closePeer, createOffer, flushCandidates, connectRemoteAudio]);

  useEffect(() => {
    nearbyRef.current = nearbyPlayers;
    updateSpatialAudio();

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
  }, [nearbyPlayers, socket, closePeer, updateSpatialAudio]);

  useEffect(() => {
    const onDisconnect = () => {
      for (const peerId of peersRef.current.keys()) {
        closePeer(peerId);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      pendingCandidatesRef.current.clear();
      setPeerStates({});
      mutedRef.current = false;
      setMuted(false);
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
      pendingCandidatesRef.current.clear();
      setPeerStates({});
    };
  }, [socket, closePeer]);

  useEffect(
    () => () => {
      const context = audioContextRef.current;
      if (!context) return;

      context.onstatechange = null;
      context.close().catch((error) => {
        console.error("Could not close audio context:", error);
      });
      audioContextRef.current = null;
    },
    []
  );

  return {
    voiceEnabled,
    muted,
    speakerVolume,
    audioOutputBlocked,
    voiceStatus,
    peerStates,
    enableVoice,
    disableVoice,
    toggleMute,
    updateSpeakerVolume,
    resumeAudio,
  };
}
