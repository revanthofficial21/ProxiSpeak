
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSoundBlocked,
  occlusionSettings,
  CLEAR_LOWPASS_HZ,
} from "./occlusion";

// Spatial audio: peers fade out with distance and pan by relative position.
const PROXIMITY_RADIUS = 100;
const MAX_GAIN = 1;

// Audio-level metering. An AnalyserNode taps a stream without affecting the
// signal, so the meter reflects exactly what is being heard.
function createLevelAnalyser(ctx) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  return analyser;
}

// Root-mean-square of the waveform, scaled so normal speech fills the meter.
function readLevel(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}

export default function useVoiceChat(
  socket,
  positionsRef,
  {
    micDeviceId = "",
    obstacles = [],
    preserveTrackRef = null,
    meetingParticipantsRef = null,
  } = {}
) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat disabled");
  const [muted, setMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(100);
  const [audioOutputBlocked, setAudioOutputBlocked] = useState(false);
  const [peerLevels, setPeerLevels] = useState({});
  const [micLevel, setMicLevel] = useState(0);

  const streamRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const obstaclesRef = useRef(obstacles);
  const audioContextRef = useRef(null);
  const mixerRef = useRef(new Map()); // peerId -> { source, gain, panner }
  const speakerVolumeRef = useRef(1); // master volume, 0..1
  const blockedRef = useRef(false);

  // The room layout can change while the loop runs; a ref keeps it current.
  useEffect(() => {
    obstaclesRef.current = obstacles;
  }, [obstacles]);

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
    } catch {
      // already disconnected
    }
    try {
      nodes.gain.disconnect();
    } catch {
      // already disconnected
    }
    if (nodes.panner) {
      try {
        nodes.panner.disconnect();
      } catch {
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

      // Occlusion: a low-pass between the gain and the output dulls a voice that
      // has furniture in the way, the way a wall does.
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = CLEAR_LOWPASS_HZ;
      lowpass.Q.value = 0.7;

      source.connect(gain);
      gain.connect(lowpass);

      // A parallel tap for the level meter — connected to nothing downstream.
      const analyser = createLevelAnalyser(ctx);
      source.connect(analyser);

      let panner = null;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        lowpass.connect(panner);
        panner.connect(ctx.destination);
      } else {
        lowpass.connect(ctx.destination);
      }

      mixerRef.current.set(peerId, { source, gain, lowpass, panner, analyser });
    },
    [ensureAudioContext, detachMixer]
  );

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
        // An exact device is requested when one is picked; otherwise the browser
        // default, which is also what a first-time user gets.
        audio: micDeviceId
          ? { deviceId: { exact: micDeviceId } }
          : true,
        video: false,
      });

      streamRef.current = stream;

      // Meter the local microphone too, so "is my mic working?" is visible.
      const micCtx = ensureAudioContext();
      if (micCtx) {
        const micAnalyser = createLevelAnalyser(micCtx);
        micCtx.createMediaStreamSource(stream).connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;
      }
      setVoiceEnabled(true);
      setVoiceStatus("Microphone enabled — waiting for nearby players");
    } catch (error) {
      console.error("Microphone access failed:", error);
      setVoiceStatus(
        error.name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Could not access microphone"
      );
    }
  }, [socket, ensureAudioContext, micDeviceId]);

  const disableVoice = () => {
    streamRef.current?.getTracks().forEach((track) => {
      if (track !== preserveTrackRef?.current) track.stop();
    });
    if (!preserveTrackRef?.current) streamRef.current = null;
    micAnalyserRef.current = null;
    setMicLevel(0);
    setPeerLevels({});
    setVoiceEnabled(false);
    setMuted(false);
    setVoiceStatus("Voice chat disabled");
  };

  useEffect(() => {
    const onDisconnect = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      micAnalyserRef.current = null;
      setMicLevel(0);
      setPeerLevels({});
      setVoiceEnabled(false);
      setMuted(false);
      setVoiceStatus("Server disconnected");
    };

    socket?.on("disconnect", onDisconnect);

    return () => {
      socket?.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      for (const peerId of mixerRef.current.keys()) detachMixer(peerId);
    },
    [detachMixer]
  );

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
    let lastLevelSample = 0;
    const levelBuffer = new Uint8Array(256);

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
            const isMeetingPeer =
              meetingParticipantsRef?.current?.has(peerId) || false;

            // Furniture in the way muffles the voice: less gain, duller tone.
            const { gainScale, lowpassHz } = occlusionSettings(
              !isMeetingPeer &&
                isSoundBlocked(local, peer, obstaclesRef.current)
            );

            // Linear fall-off: full volume at 0px, silent at the radius edge,
            // scaled by the master speaker volume and any occlusion.
            const targetGain =
              MAX_GAIN *
              speakerVolumeRef.current *
              gainScale *
              (isMeetingPeer
                ? 1
                : Math.max(0, Math.min(1, 1 - distance / PROXIMITY_RADIUS)));

            // setTargetAtTime smooths the change, avoiding zipper clicks.
            nodes.gain.gain.setTargetAtTime(targetGain, now, 0.05);

            if (nodes.lowpass) {
              nodes.lowpass.frequency.setTargetAtTime(lowpassHz, now, 0.08);
            }

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

      // Sample the meters a few times a second, not on every frame.
      if (performance.now() - lastLevelSample > 120) {
        lastLevelSample = performance.now();
        const buffer = levelBuffer;
        const nextLevels = {};
        for (const [peerId, nodes] of mixerRef.current.entries()) {
          nextLevels[peerId] = nodes.analyser
            ? readLevel(nodes.analyser, buffer)
            : 0;
        }
        setPeerLevels(nextLevels);
        setMicLevel(
          micAnalyserRef.current ? readLevel(micAnalyserRef.current, buffer) : 0
        );
      }

      frame = requestAnimationFrame(mix);
    };

    frame = requestAnimationFrame(mix);
    return () => cancelAnimationFrame(frame);
  }, [socket, positionsRef, meetingParticipantsRef]);

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

  // Send the mix to a chosen speaker. setSinkId is newer than the rest of this
  // hook, so it is feature-detected rather than assumed.
  const changeOutputDevice = useCallback(async (deviceId) => {
    const ctx = audioContextRef.current;
    if (!ctx || typeof ctx.setSinkId !== "function") return;

    try {
      await ctx.setSinkId(deviceId || "");
    } catch (error) {
      console.error("Could not switch audio output:", error);
    }
  }, []);

  return {
    voiceEnabled,
    voiceStatus,
    peerLevels,
    micLevel,
    muted,
    speakerVolume,
    audioOutputBlocked,
    enableVoice,
    disableVoice,
    toggleMute,
    changeSpeakerVolume,
    changeOutputDevice,
    resumeAudio,
    streamRef,
    attachRemoteStream,
    detachRemoteStream: detachMixer,
  };
}
