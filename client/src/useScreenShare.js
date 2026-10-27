import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Optional TURN relay — same env config as the voice hook.
const turnUrl = import.meta.env.VITE_TURN_URL;
if (turnUrl) {
  ICE_SERVERS.push({
    urls: turnUrl,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}
const MEETING_ROOM = "Meeting Room";

export default function useScreenShare(socket, activeRoomId) {
  const [isSharing, setIsSharing] = useState(false);
  const [startingShare, setStartingShare] = useState(false);
  const [screenShares, setScreenShares] = useState([]);
  const [screenShareError, setScreenShareError] = useState("");
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const sharersRef = useRef(new Map());
  const roomRef = useRef(activeRoomId);

  const closePeer = useCallback((peerId) => {
    pendingCandidatesRef.current.delete(peerId);
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    entry.pc.ontrack = null;
    entry.pc.onicecandidate = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    peersRef.current.delete(peerId);
  }, []);

  const stopLocalShare = useCallback(
    ({ notify = true, message = "" } = {}) => {
      const stream = localStreamRef.current;
      localStreamRef.current = null;
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      for (const peerKey of peersRef.current.keys()) {
        if (peerKey.startsWith("out:")) closePeer(peerKey);
      }
      setIsSharing(false);
      setStartingShare(false);
      setScreenShares((current) =>
        current.filter((share) => share.sharerId !== socket?.id)
      );
      if (notify && socket?.connected) socket.emit("screen:stop");
      if (message) setScreenShareError(message);
    },
    [socket, closePeer]
  );

  const attachRemoteStream = useCallback((sharerId, stream) => {
    const sharer = sharersRef.current.get(sharerId);
    setScreenShares((current) => {
      const existing = current.find((share) => share.sharerId === sharerId);
      const nextShare = {
        sharerId,
        name: sharer?.name || `Player ${sharerId.slice(0, 4)}`,
        stream,
      };
      return existing
        ? current.map((share) =>
            share.sharerId === sharerId ? nextShare : share
          )
        : [...current, nextShare];
    });
  }, []);

  const flushCandidates = useCallback(async (peerId, pc) => {
    const candidates = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add screen-share ICE candidate:", error);
      }
    }
  }, []);

  const createOffer = useCallback(
    async (viewerId) => {
      const stream = localStreamRef.current;
      const peerKey = `out:${viewerId}`;
      if (
        !stream ||
        !socket?.connected ||
        roomRef.current !== MEETING_ROOM ||
        peersRef.current.has(peerKey)
      ) {
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (event) => {
        if (event.candidate && socket.connected) {
          socket.emit("screen:ice-candidate", {
            targetId: viewerId,
            shareId: socket.id,
            candidate: event.candidate,
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerKey);
        }
      };
      peersRef.current.set(peerKey, { pc });

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (socket.connected) {
          socket.emit("screen:offer", {
            targetId: viewerId,
            shareId: socket.id,
            offer: pc.localDescription,
          });
        }
      } catch (error) {
        console.error("Could not create screen-share offer:", error);
        closePeer(peerKey);
      }
    },
    [socket, closePeer]
  );

  const startScreenShare = useCallback(async () => {
    if (activeRoomId !== MEETING_ROOM) return;
    if (!socket?.connected) {
      setScreenShareError("Connect to the server before sharing your screen.");
      return;
    }
    if (localStreamRef.current || startingShare) return;
    const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
    if (typeof getDisplayMedia !== "function") {
      setScreenShareError("Screen sharing is not supported in this browser.");
      return;
    }

    setScreenShareError("");
    setStartingShare(true);
    let stream;
    try {
      stream = await getDisplayMedia.call(navigator.mediaDevices, {
        video: true,
        audio: true,
      });
      if (roomRef.current !== MEETING_ROOM || !socket.connected) {
        stream.getTracks().forEach((track) => track.stop());
        setStartingShare(false);
        return;
      }

      localStreamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => stopLocalShare();
      });

      socket.timeout(5000).emit("screen:start", (timeoutError, result) => {
        if (timeoutError || !result?.success) {
          stopLocalShare({
            notify: false,
            message:
              result?.error || "Could not start screen sharing. Try again.",
          });
          return;
        }
        setStartingShare(false);
        setIsSharing(true);
        attachRemoteStream(socket.id, stream);
      });
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      setStartingShare(false);
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setScreenShareError("Screen-sharing permission was denied.");
      } else if (error.name === "NotFoundError") {
        setScreenShareError("No screen, window, or tab is available to share.");
      } else {
        console.error("Could not access screen capture:", error);
        setScreenShareError("Could not start screen sharing. Check browser permissions.");
      }
    }
  }, [
    activeRoomId,
    socket,
    startingShare,
    stopLocalShare,
    attachRemoteStream,
  ]);

  useEffect(() => {
    roomRef.current = activeRoomId;
    if (activeRoomId === MEETING_ROOM) return;

    if (localStreamRef.current) stopLocalShare();
    for (const peerId of peersRef.current.keys()) closePeer(peerId);
    pendingCandidatesRef.current.clear();
    sharersRef.current.clear();
    setScreenShares([]);
    setScreenShareError("");
  }, [activeRoomId, socket, closePeer, stopLocalShare]);

  useEffect(() => {
    if (activeRoomId === MEETING_ROOM && socket?.connected) {
      socket.emit("screen:list");
    }
  }, [activeRoomId, socket]);

  useEffect(() => {
    if (!socket) return undefined;

    const setSharer = (sharerId, name) => {
      if (!sharerId || sharerId === socket.id) return;
      sharersRef.current.set(sharerId, { name });
      setScreenShares((current) =>
        current.some((share) => share.sharerId === sharerId)
          ? current.map((share) =>
              share.sharerId === sharerId ? { ...share, name } : share
            )
          : [...current, { sharerId, name, stream: null }]
      );
      socket.emit("screen:watch", { sharerId });
    };

    // The server sends `room` (main's room name), not `roomId`.
    const onList = ({ room, shares } = {}) => {
      if (room !== MEETING_ROOM || roomRef.current !== MEETING_ROOM) {
        return;
      }
      const validShares = Array.isArray(shares)
        ? shares.filter((share) => share && typeof share.sharerId === "string")
        : [];
      const validIds = new Set(validShares.map((share) => share.sharerId));
      for (const peerId of sharersRef.current.keys()) {
        if (!validIds.has(peerId)) {
          closePeer(`in:${peerId}`);
          sharersRef.current.delete(peerId);
        }
      }
      setScreenShares((current) =>
        current.filter(
          (share) => share.sharerId === socket.id || validIds.has(share.sharerId)
        )
      );
      validShares.forEach((share) => setSharer(share.sharerId, share.name));
    };

    const onAvailable = ({ sharerId, name } = {}) => {
      if (roomRef.current === MEETING_ROOM) setSharer(sharerId, name);
    };

    const onViewer = ({ viewerId } = {}) => {
      if (viewerId) void createOffer(viewerId);
    };

    const onOffer = async ({ fromId, offer } = {}) => {
      if (
        !fromId ||
        !offer ||
        roomRef.current !== MEETING_ROOM ||
        !sharersRef.current.has(fromId)
      ) {
        return;
      }
      const peerKey = `in:${fromId}`;
      closePeer(peerKey);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        attachRemoteStream(fromId, stream);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate && socket.connected) {
          socket.emit("screen:ice-candidate", {
            targetId: fromId,
            shareId: fromId,
            candidate: event.candidate,
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerKey);
        }
      };
      peersRef.current.set(peerKey, { pc });
      try {
        await pc.setRemoteDescription(offer);
        await flushCandidates(peerKey, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("screen:answer", {
          targetId: fromId,
          shareId: fromId,
          answer: pc.localDescription,
        });
      } catch (error) {
        console.error("Could not answer screen-share offer:", error);
        closePeer(peerKey);
      }
    };

    const onAnswer = async ({ fromId, shareId, answer } = {}) => {
      const entry =
        shareId === socket.id
          ? peersRef.current.get(`out:${fromId}`)
          : null;
      if (!entry || !answer) return;
      try {
        await entry.pc.setRemoteDescription(answer);
        await flushCandidates(`out:${fromId}`, entry.pc);
      } catch (error) {
        console.error("Could not set screen-share answer:", error);
        closePeer(`out:${fromId}`);
      }
    };

    const onCandidate = async ({ fromId, shareId, candidate } = {}) => {
      if (!fromId || !shareId || !candidate) return;
      const peerKey =
        shareId === socket.id ? `out:${fromId}` : `in:${shareId}`;
      const entry = peersRef.current.get(peerKey);
      if (!entry || !entry.pc.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(peerKey) || [];
        pending.push(candidate);
        pendingCandidatesRef.current.set(peerKey, pending);
        return;
      }
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Could not add screen-share ICE candidate:", error);
      }
    };

    const onStopped = ({ sharerId } = {}) => {
      if (!sharerId) return;
      if (sharerId === socket.id) {
        stopLocalShare({ notify: false });
      } else {
        closePeer(`in:${sharerId}`);
      }
      sharersRef.current.delete(sharerId);
      setScreenShares((current) =>
        current.filter((share) => share.sharerId !== sharerId)
      );
    };

    const onViewerLeft = ({ viewerId } = {}) => {
      if (viewerId) closePeer(`out:${viewerId}`);
    };

    const onConnect = () => {
      if (roomRef.current === MEETING_ROOM) socket.emit("screen:list");
    };
    const onDisconnect = () => {
      stopLocalShare({ notify: false });
      for (const peerId of peersRef.current.keys()) closePeer(peerId);
      sharersRef.current.clear();
      setScreenShares([]);
    };

    socket.on("screen:list", onList);
    socket.on("screen:available", onAvailable);
    socket.on("screen:viewer", onViewer);
    socket.on("screen:offer", onOffer);
    socket.on("screen:answer", onAnswer);
    socket.on("screen:ice-candidate", onCandidate);
    socket.on("screen:stopped", onStopped);
    socket.on("screen:viewer-left", onViewerLeft);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("screen:list", onList);
      socket.off("screen:available", onAvailable);
      socket.off("screen:viewer", onViewer);
      socket.off("screen:offer", onOffer);
      socket.off("screen:answer", onAnswer);
      socket.off("screen:ice-candidate", onCandidate);
      socket.off("screen:stopped", onStopped);
      socket.off("screen:viewer-left", onViewerLeft);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      stopLocalShare({ notify: false });
      for (const peerId of peersRef.current.keys()) closePeer(peerId);
      sharersRef.current.clear();
    };
  }, [
    socket,
    closePeer,
    createOffer,
    flushCandidates,
    attachRemoteStream,
    stopLocalShare,
  ]);

  return {
    isSharing,
    startingShare,
    screenShares,
    screenShareError,
    startScreenShare,
    stopScreenShare: () => stopLocalShare(),
  };
}
