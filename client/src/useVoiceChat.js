import { useCallback, useEffect, useRef, useState } from "react";

const PROXIMITY_DISTANCE = 100;

const RTC_CONFIGURATION = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

export default function useVoiceChat(socket, playerPosition) {
    const [isMicEnabled, setIsMicEnabled] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState([]);
    const [voiceError, setVoiceError] = useState("");

    const localStreamRef = useRef(null);
    const peerConnectionsRef = useRef(new Map());
    const audioElementsRef = useRef(new Map());
    const audioContextRef = useRef(null);
    const audioNodesRef = useRef(new Map());
    const positionRef = useRef(playerPosition);

    useEffect(() => {
        positionRef.current = playerPosition;
    }, [playerPosition]);

    const distanceBetween = useCallback((a, b) => {
        return Math.hypot(
            Number(a.x) - Number(b.x),
            Number(a.y) - Number(b.y)
        );
    }, []);

    const closePeer = useCallback((peerId) => {
        const pc = peerConnectionsRef.current.get(peerId);

        if (pc) {
            pc.onicecandidate = null;
            pc.ontrack = null;
            pc.onconnectionstatechange = null;
            pc.close();
            peerConnectionsRef.current.delete(peerId);
        }

        const audio = audioElementsRef.current.get(peerId);

        if (audio) {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
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

        setConnectedPeers(previous =>
            previous.filter(id => id !== peerId)
        );
    }, []);

    const getMicrophone = useCallback(async () => {
        if (localStreamRef.current) {
            return localStreamRef.current;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Microphone access is not supported.");
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

        return stream;
    }, []);

    const updateSpatialAudio = useCallback((peerId, remotePosition) => {
        const localPosition = positionRef.current;

        if (!localPosition || !remotePosition) return;

        const distance = distanceBetween(
            localPosition,
            remotePosition
        );

        const nodes = audioNodesRef.current.get(peerId);

        if (!nodes) return;

        if (distance > PROXIMITY_DISTANCE) {
            nodes.gain.gain.setTargetAtTime(
                0,
                audioContextRef.current.currentTime,
                0.05
            );
            return;
        }

        const volume = Math.max(
            0,
            1 - distance / PROXIMITY_DISTANCE
        );

        const horizontalDistance =
            Number(remotePosition.x) - Number(localPosition.x);

        const pan = Math.max(
            -1,
            Math.min(1, horizontalDistance / PROXIMITY_DISTANCE)
        );

        nodes.gain.gain.setTargetAtTime(
            volume,
            audioContextRef.current.currentTime,
            0.05
        );

        nodes.panner.pan.setTargetAtTime(
            pan,
            audioContextRef.current.currentTime,
            0.05
        );
    }, [distanceBetween]);

    const createPeerConnection = useCallback(async (peerId) => {
        if (peerConnectionsRef.current.has(peerId)) {
            return peerConnectionsRef.current.get(peerId);
        }

        const stream = await getMicrophone();

        const pc = new RTCPeerConnection(RTC_CONFIGURATION);

        stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
        });

        pc.onicecandidate = event => {
            if (event.candidate) {
                socket.emit("webrtc:ice-candidate", {
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = async event => {
            let audio = audioElementsRef.current.get(peerId);

            if (!audio) {
                audio = document.createElement("audio");
                audio.autoplay = true;
                audio.playsInline = true;
                audio.dataset.peerId = peerId;

                document.body.appendChild(audio);

                audioElementsRef.current.set(peerId, audio);
            }

            audio.srcObject = event.streams[0];

            try {
                if (!audioContextRef.current) {
                    audioContextRef.current =
                        new AudioContext();
                }

                const context = audioContextRef.current;

                if (!audioNodesRef.current.has(peerId)) {
                    const source =
                        context.createMediaStreamSource(
                            event.streams[0]
                        );

                    const gain = context.createGain();
                    const panner = context.createStereoPanner();

                    source.connect(gain);
                    gain.connect(panner);
                    panner.connect(context.destination);

                    audioNodesRef.current.set(peerId, {
                        source,
                        gain,
                        panner
                    });
                }

                if (context.state === "suspended") {
                    await context.resume();
                }

                const remotePosition = await getPlayerPosition(peerId);

                if (remotePosition) {
                    updateSpatialAudio(peerId, remotePosition);
                }

            } catch (error) {
                console.error("Spatial audio error:", error);
            }

            audio.play().catch(() => {
                setVoiceError(
                    "Click the page to allow audio playback."
                );
            });
        };

        pc.onconnectionstatechange = () => {
            if (
                pc.connectionState === "connected"
            ) {
                setConnectedPeers(previous =>
                    previous.includes(peerId)
                        ? previous
                        : [...previous, peerId]
                );
            }

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed" ||
                pc.connectionState === "disconnected"
            ) {
                closePeer(peerId);
            }
        };

        peerConnectionsRef.current.set(peerId, pc);

        return pc;
    }, [socket, getMicrophone, closePeer, updateSpatialAudio]);

    async function getPlayerPosition(peerId) {
        return new Promise(resolve => {
            socket.emit("player:get-position", {
                socketId: peerId
            }, resolve);
        });
    }

    const callPeer = useCallback(async (peerId) => {
        try {
            const pc = await createPeerConnection(peerId);

            if (pc.signalingState !== "stable") return;

            const offer = await pc.createOffer();

            await pc.setLocalDescription(offer);

            socket.emit("webrtc:offer", {
                to: peerId,
                offer
            });
        } catch (error) {
            console.error("Peer call error:", error);
            setVoiceError(error.message);
        }
    }, [socket, createPeerConnection]);

    const enableMicrophone = useCallback(async () => {
        try {
            await getMicrophone();

            if (audioContextRef.current?.state === "suspended") {
                await audioContextRef.current.resume();
            }

            setIsMicEnabled(true);
            setVoiceError("");

            socket.emit("voice:join");
        } catch (error) {
            setVoiceError(
                error.message || "Unable to access microphone."
            );
        }
    }, [socket, getMicrophone]);

    const disableMicrophone = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
            });

            localStreamRef.current = null;
        }

        peerConnectionsRef.current.forEach((pc, peerId) => {
            closePeer(peerId);
        });

        socket.emit("voice:leave");

        setIsMicEnabled(false);
    }, [socket, closePeer]);

    useEffect(() => {
        if (!socket) return;

        const handlePeerRequest = async ({ from }) => {
            if (!isMicEnabled || !from) return;

            try {
                const pc = await createPeerConnection(from);

                if (pc.signalingState !== "stable") return;

                const offer = await pc.createOffer();

                await pc.setLocalDescription(offer);

                socket.emit("webrtc:offer", {
                    to: from,
                    offer
                });
            } catch (error) {
                console.error(error);
            }
        };

        const handleOffer = async ({ from, offer }) => {
            try {
                if (!isMicEnabled || !from) return;

                const pc = await createPeerConnection(from);

                if (pc.signalingState !== "stable") return;

                await pc.setRemoteDescription(offer);

                const answer = await pc.createAnswer();

                await pc.setLocalDescription(answer);

                socket.emit("webrtc:answer", {
                    to: from,
                    answer
                });
            } catch (error) {
                console.error("Offer handling error:", error);
            }
        };

        const handleAnswer = async ({ from, answer }) => {
            try {
                const pc = peerConnectionsRef.current.get(from);

                if (pc && pc.signalingState === "have-local-offer") {
                    await pc.setRemoteDescription(answer);
                }
            } catch (error) {
                console.error("Answer handling error:", error);
            }
        };

        const handleIceCandidate = async ({ from, candidate }) => {
            try {
                const pc = peerConnectionsRef.current.get(from);

                if (pc && candidate) {
                    await pc.addIceCandidate(candidate);
                }
            } catch (error) {
                console.error("ICE candidate error:", error);
            }
        };

        const handlePeerLeft = ({ socketId }) => {
            closePeer(socketId);
        };

        const handleNearby = async players => {
            if (!isMicEnabled || !Array.isArray(players)) return;

            for (const player of players) {
                if (
                    !player.socketId ||
                    peerConnectionsRef.current.has(player.socketId)
                ) {
                    continue;
                }

                const distance = distanceBetween(
                    positionRef.current,
                    player
                );

                if (distance <= PROXIMITY_DISTANCE) {
                    socket.emit("voice:request-peer", {
                        to: player.socketId
                    });
                }
            }
        };

        socket.on("voice:peer-request", handlePeerRequest);
        socket.on("webrtc:offer", handleOffer);
        socket.on("webrtc:answer", handleAnswer);
        socket.on("webrtc:ice-candidate", handleIceCandidate);
        socket.on("voice:peer-left", handlePeerLeft);
        socket.on("voice:nearby", handleNearby);

        return () => {
            socket.off("voice:peer-request", handlePeerRequest);
            socket.off("webrtc:offer", handleOffer);
            socket.off("webrtc:answer", handleAnswer);
            socket.off("webrtc:ice-candidate", handleIceCandidate);
            socket.off("voice:peer-left", handlePeerLeft);
            socket.off("voice:nearby", handleNearby);
        };
    }, [
        socket,
        isMicEnabled,
        createPeerConnection,
        closePeer,
        distanceBetween
    ]);

    useEffect(() => {
        const timer = setInterval(() => {
            peerConnectionsRef.current.forEach((pc, peerId) => {
                const audio = audioElementsRef.current.get(peerId);

                if (!audio) return;

                // The backend must supply current player positions
                // through the world/movement events.
                const remote = window.__proxyspeakPlayers?.[peerId];

                if (remote) {
                    updateSpatialAudio(peerId, remote);
                }
            });
        }, 100);

        return () => clearInterval(timer);
    }, [updateSpatialAudio]);

    useEffect(() => {
        return () => {
            peerConnectionsRef.current.forEach(pc => pc.close());
            peerConnectionsRef.current.clear();

            audioElementsRef.current.forEach(audio => {
                audio.pause();
                audio.srcObject = null;
                audio.remove();
            });

            audioElementsRef.current.clear();

            localStreamRef.current?.getTracks().forEach(track => {
                track.stop();
            });

            audioContextRef.current?.close();
        };
    }, []);

    return {
        isMicEnabled,
        connectedPeers,
        voiceError,
        enableMicrophone,
        disableMicrophone
    };
}
