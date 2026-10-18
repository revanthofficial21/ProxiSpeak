

import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'

function App() {
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [connected, setConnected] = useState(false)
  const [players, setPlayers] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [socketInstance, setSocketInstance] = useState(null)

  useEffect(() => {
    const socket = io('http://localhost:3000', {
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
    })

    setSocketInstance(socket)

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id)
      setConnected(true)
      setMyPlayerId(socket.id)
    })

    socket.on('connect_error', (error) => {
      console.error('Socket connection failed:', error.message)
      setConnected(false)
    })

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason)
      setConnected(false)
      setMyPlayerId(null)
    })

    socket.on('world:state', (playerList) => {
      setPlayers(Array.isArray(playerList) ? playerList : [])
    })

    socket.on('player:joined', (player) => {
      setPlayers((current) => [
        ...current.filter((p) => p.id !== player.id),
        player,
      ])
    })

    socket.on('player:moved', (updatedPlayer) => {
      setPlayers((current) =>
        current.map((p) =>
          p.id === updatedPlayer.id ? updatedPlayer : p
        )
      )
    })

    socket.on('player:renamed', (updatedPlayer) => {
      setPlayers((current) =>
        current.map((p) =>
          p.id === updatedPlayer.id ? updatedPlayer : p
        )
      )
    })

    socket.on('player:left', (playerId) => {
      setPlayers((current) =>
        current.filter((p) => p.id !== playerId)
      )
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [])

  const movePlayer = (direction) => {
    if (!socketInstance?.connected || !myPlayerId || !joined) return

    const me = players.find((p) => p.id === myPlayerId)
    if (!me) {
      console.log('Your player is not in the current world state yet.')
      return
    }

    const step = 10
    let x = me.x
    let y = me.y

    if (direction === 'up') y -= step
    if (direction === 'down') y += step
    if (direction === 'left') x -= step
    if (direction === 'right') x += step

    socketInstance.emit('player:move', { x, y })
  }

  useEffect(() => {
    if (!joined) return

    const handleKeyDown = (event) => {
      const directions = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }

      const direction = directions[event.key]
      if (!direction) return

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      event.preventDefault()
      movePlayer(direction)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [joined, socketInstance, myPlayerId, players])

  const handleJoin = (event) => {
    event.preventDefault()

    const trimmedName = playerName.trim()

    if (!trimmedName || !connected || !socketInstance?.connected) {
      console.log('Cannot join:', {
        playerName: trimmedName,
        connected,
        socketConnected: socketInstance?.connected,
      })
      return
    }

    socketInstance.emit('player:setName', trimmedName, (response) => {
      console.log('Name save response:', response)
    })

    setPlayerName(trimmedName)
    setJoined(true)
  }

  return (
    <main className="app">
      <header className="navbar">
        <h2>🎧 ProxiSpeak</h2>
        <span>Geospatial Audio Ecosystem</span>
      </header>

      <section className="hero-section">
        <p className="tagline">YOUR WORLD, YOUR SOUND</p>
        <h1>Discover Sound Around You.</h1>

        <p className="description">
          Explore nearby people and connect through location-based audio.
        </p>

        <p>
          Server status:{' '}
          <strong>{connected ? 'Connected' : 'Connecting...'}</strong>
        </p>

        {!joined ? (
          <form onSubmit={handleJoin}>
            <input
              type="text"
              placeholder="Enter your player name"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              required
            />

            <button type="submit" disabled={!connected}>
              Enter ProxiSpeak →
            </button>
          </form>
        ) : (
          <div className="welcome">
            <h2>Welcome, {playerName}!</h2>
            <p>Use your keyboard arrow keys or the buttons to move.</p>

            <div className="movement-controls">
              <button type="button" onClick={() => movePlayer('up')}>
                ⬆️
              </button>

              <div>
                <button type="button" onClick={() => movePlayer('left')}>
                  ⬅️
                </button>
                <button type="button" onClick={() => movePlayer('down')}>
                  ⬇️
                </button>
                <button type="button" onClick={() => movePlayer('right')}>
                  ➡️
                </button>
              </div>
            </div>

            <button type="button" onClick={() => setJoined(false)}>
              Go back
            </button>
          </div>
        )}
      </section>

      <section className="features">
        <article>
          <span>📍</span>
          <h3>Explore Nearby</h3>
          <p>Discover the world around your location.</p>
        </article>

        <article>
          <span>🎙️</span>
          <h3>Spatial Audio</h3>
          <p>Experience audio based on proximity.</p>
        </article>

        <article>
          <span>🌐</span>
          <h3>Live Connections</h3>
          <p>Build real-time connections with nearby players.</p>
        </article>
      </section>

      <section className="features">
        <article>
          <h3>🌍 Live World</h3>
          <p>Connected players: {players.length}</p>

          {players.map((player) => (
            <p key={player.id}>
              <strong>
                {player.id === myPlayerId ? 'You' : player.name || 'Player'}
              </strong>
              {' — '}
              X: {player.x}, Y: {player.y}
              {player.id === myPlayerId && ' 👈'}
            </p>
          ))}
        </article>
      </section>

      <footer>ProxiSpeak · Connect through sound.</footer>
    </main>
  )
}

export default App

