
import { useCallback, useEffect, useRef, useState } from 'react'

const RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
}

export function useVoiceChat({ socket, joined, players, myPlayerId }) {
  const streamRef = useRef(null)
  const peersRef = useRef(new Map())
  const audioRef = useRef(new Map())
  const pendingCandidatesRef = useRef(new Map())

  const [micEnabled, setMicEnabled] = useState(false)
  const [muted, setMuted] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [connectedVoicePeers, setConnectedVoicePeers] = useState([])

  const closePeer = useCallback((peerId, notify = false) => {
    const peer = peersRef.current.get(peerId)

    if (notify && socket?.connected) {
      socket.emit('voice:leave', { to: peerId })
    }

    if (peer) {
      peer.ontrack = null
      peer.onicecandidate = null
      peer.onconnectionstatechange = null
      peer.close()
      peersRef.current.delete(peerId)
    }

    const audio = audioRef.current.get(peerId)
    if (audio) {
      audio.pause()
      audio.srcObject = null
      audioRef.current.delete(peerId)
    }

    pendingCandidatesRef.current.delete(peerId)
    setConnectedVoicePeers((current) =>
      current.filter((id) => id !== peerId)
    )
  }, [socket])

  const createPeer = useCallback((peerId) => {
    if (!streamRef.current || !socket?.connected) return null

    const existing = peersRef.current.get(peerId)
    if (existing) return existing

    const peer = new RTCPeerConnection(RTC_CONFIGURATION)

    streamRef.current.getTracks().forEach((track) => {
      peer.addTrack(track, streamRef.current)
    })

    peer.onicecandidate = (event) => {
      if (event.candidate && socket.connected) {
        socket.emit('voice:ice-candidate', {
          to: peerId,
          candidate: event.candidate,
        })
      }
    }

    peer.ontrack = (event) => {
      let audio = audioRef.current.get(peerId)

      if (!audio) {
        audio = new Audio()
        audio.autoplay = true
        audio.playsInline = true
        audioRef.current.set(peerId, audio)
      }

      audio.srcObject = event.streams[0]
      audio.play().catch((error) => {
        console.warn('Audio playback needs user interaction:', error)
      })
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setConnectedVoicePeers((current) =>
          current.includes(peerId) ? current : [...current, peerId]
        )
      }

      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        closePeer(peerId)
      }
    }

    peersRef.current.set(peerId, peer)
    return peer
  }, [socket, closePeer])

  const enableVoice = useCallback(async () => {
    if (!joined || !socket?.connected) {
      setVoiceError('Join the world and connect to the server first.')
      return
    }

    if (streamRef.current) return

    try {
      setVoiceError('')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Microphone access is unavailable. Open the app on localhost or HTTPS.'
        )
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      streamRef.current = stream
      setMicEnabled(true)
      setMuted(false)
    } catch (error) {
      console.error('Microphone access failed:', error)
      setVoiceError(
        error.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow microphone access in your browser.'
          : error.message || 'Could not access the microphone.'
      )
    }
  }, [joined, socket])

  const disableVoice = useCallback(() => {
    for (const peerId of peersRef.current.keys()) {
      closePeer(peerId, true)
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    setMicEnabled(false)
    setMuted(false)
    setConnectedVoicePeers([])
  }, [closePeer])

  const toggleMute = useCallback(() => {
    if (!streamRef.current) return

    const nextMuted = !muted

    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted
    })

    setMuted(nextMuted)
  }, [muted])

  // Receive WebRTC offers, answers, ICE candidates, and leave notices.
  useEffect(() => {
    if (!socket) return

    const flushCandidates = async (peerId, peer) => {
      const candidates = pendingCandidatesRef.current.get(peerId) || []
      pendingCandidatesRef.current.delete(peerId)

      for (const candidate of candidates) {
        try {
          await peer.addIceCandidate(candidate)
        } catch (error) {
          console.error('Failed to add queued ICE candidate:', error)
        }
      }
    }

    const handleOffer = async ({ from, offer } = {}) => {
      if (!from || !offer || !streamRef.current || !joined) return

      try {
        const peer = createPeer(from)
        if (!peer) return

        await peer.setRemoteDescription(offer)
        await flushCandidates(from, peer)

        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)

        socket.emit('voice:answer', {
          to: from,
          answer: peer.localDescription,
        })
      } catch (error) {
        console.error('Failed to handle voice offer:', error)
        closePeer(from)
      }
    }

    const handleAnswer = async ({ from, answer } = {}) => {
      const peer = peersRef.current.get(from)
      if (!peer || !answer) return

      try {
        await peer.setRemoteDescription(answer)
        await flushCandidates(from, peer)
      } catch (error) {
        console.error('Failed to handle voice answer:', error)
        closePeer(from)
      }
    }

    const handleCandidate = async ({ from, candidate } = {}) => {
      const peer = peersRef.current.get(from)
      if (!peer || !candidate) return

      if (!peer.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(from) || []
        pending.push(candidate)
        pendingCandidatesRef.current.set(from, pending)
        return
      }

      try {
        await peer.addIceCandidate(candidate)
      } catch (error) {
        console.error('Failed to add ICE candidate:', error)
      }
    }

    const handleReady = ({ from } = {}) => {
      if (!from || !streamRef.current || !joined || !myPlayerId) return;

      // Only one player in each pair should create the offer.
      if (String(myPlayerId) >= String(from)) return;
      if (peersRef.current.has(from)) return;

      const peer = createPeer(from);
      if (!peer) return;

      peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .then(() => {
          if (socket.connected && peersRef.current.get(from) === peer) {
            socket.emit('voice:offer', {
              to: from,
              offer: peer.localDescription,
            });
          }
        })
        .catch((error) => {
          console.error('Failed to create voice offer:', error);
          closePeer(from);
        });
    };
    const handleLeave = ({ from } = {}) => {
      if (from) closePeer(from)
    }

    socket.on('voice:ready', handleReady)
    socket.on('voice:offer', handleOffer)
    socket.on('voice:answer', handleAnswer)
    socket.on('voice:ice-candidate', handleCandidate)
    socket.on('voice:leave', handleLeave)

    return () => {
      socket.off('voice:ready', handleReady)
      socket.off('voice:offer', handleOffer)
      socket.off('voice:answer', handleAnswer)
      socket.off('voice:ice-candidate', handleCandidate)
      socket.off('voice:leave', handleLeave)
    }
  }, [socket, joined, myPlayerId, createPeer, closePeer])

  // Notify nearby players that voice chat is ready.
  useEffect(() => {
    if (!joined || !micEnabled || !myPlayerId || !socket?.connected) {
      return
    }

    const myPlayer = players.find(
      (player) => String(player.id) === String(myPlayerId)
    )

    if (!myPlayer) return

    const nearbyIds = new Set(
      players
        .filter((player) => {
          if (
            !player?.id ||
            String(player.id) === String(myPlayerId) ||
            !player.name
          ) {
            return false
          }

          const dx = player.x - myPlayer.x
          const dy = player.y - myPlayer.y
          return Math.hypot(dx, dy) <= 100
        })
        .map((player) => player.id)
    )

    for (const peerId of peersRef.current.keys()) {
      if (!nearbyIds.has(peerId)) {
        closePeer(peerId, true)
      }
    }

    for (const peerId of nearbyIds) {
      socket.emit('voice:ready', { to: peerId })
    }
  }, [
    joined,
    micEnabled,
    players,
    myPlayerId,
    socket,
    closePeer,
  ])

  // Stop the microphone and close calls when leaving the world or unmounting.
  useEffect(() => {
    if (!joined) disableVoice()
  }, [joined, disableVoice])

  useEffect(() => {
    return () => {
      for (const peer of peersRef.current.values()) peer.close()
      peersRef.current.clear()

      for (const audio of audioRef.current.values()) {
        audio.pause()
        audio.srcObject = null
      }
      audioRef.current.clear()

      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  return {
    micEnabled,
    muted,
    voiceError,
    connectedVoicePeers,
    enableVoice,
    disableVoice,
    toggleMute,
  }
}


