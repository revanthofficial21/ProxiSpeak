import { useEffect, useMemo, useState } from "react";

function isBreakoutState(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.hostId === null || typeof value.hostId === "string") &&
      Array.isArray(value.participants) &&
      value.participants.every(
        (participant) =>
          participant &&
          typeof participant.id === "string" &&
          typeof participant.name === "string" &&
          typeof participant.isHost === "boolean" &&
          (participant.assignedRoomId === null ||
            typeof participant.assignedRoomId === "string") &&
          (participant.breakoutRoomId === null ||
            typeof participant.breakoutRoomId === "string")
      ) &&
      Array.isArray(value.rooms) &&
      value.rooms.every(
        (room) =>
          room &&
          typeof room.id === "string" &&
          typeof room.name === "string" &&
          Array.isArray(room.participants)
      )
  );
}

function emitWithAcknowledgement(socket, event, payload, setError) {
  const callback = (response) => {
    if (!response?.success) {
      setError(response?.error || "Could not update breakout rooms.");
    } else {
      setError("");
    }
  };
  if (payload === undefined) socket.emit(event, callback);
  else socket.emit(event, payload, callback);
}

function BreakoutChat({ socket, room, setError }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const handleMessage = (message) => {
      if (
        !message ||
        typeof message.id !== "string" ||
        typeof message.senderName !== "string" ||
        typeof message.text !== "string"
      ) {
        return;
      }
      setMessages((current) => [...current.slice(-99), message]);
    };
    socket.on("breakout:chat:message", handleMessage);
    return () => socket.off("breakout:chat:message", handleMessage);
  }, [socket, room.id]);

  const handleSendMessage = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    socket.emit(
      "breakout:chat:send",
      { text: draft },
      (response) => {
        if (!response?.success) {
          setError(response?.error || "Could not send breakout message.");
        } else {
          setDraft("");
          setError("");
        }
      }
    );
  };

  return (
    <section className="breakout-chat" aria-label={`${room.name} chat`}>
      <h3>{room.name} chat</h3>
      <div className="breakout-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          messages.map((message) => (
            <p className="chat-message" key={message.id}>
              <strong>{message.senderName}</strong>
              <span>{message.text}</span>
            </p>
          ))
        )}
      </div>
      <form onSubmit={handleSendMessage}>
        <label className="visually-hidden" htmlFor="breakout-chat-draft">
          Message
        </label>
        <input
          id="breakout-chat-draft"
          maxLength={500}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message this breakout room"
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

export default function BreakoutRooms({
  socket,
  enabled,
  playerId,
  state,
  onState,
}) {
  const [roomName, setRoomName] = useState("");
  const [assignmentByParticipant, setAssignmentByParticipant] = useState({});
  const [error, setError] = useState("");

  const participant = state?.participants.find((item) => item.id === playerId);
  const currentRoomId = participant?.breakoutRoomId || null;
  const currentRoom = state?.rooms.find((room) => room.id === currentRoomId);
  const isHost = state?.hostId === playerId;
  const assignableParticipants = useMemo(
    () => (state?.participants || []).filter((item) => !item.isHost),
    [state?.participants]
  );

  useEffect(() => {
    if (!socket || !enabled) return undefined;

    socket.emit("breakout:load", (response) => {
      if (response?.success && isBreakoutState(response.state)) {
        onState(response.state);
      } else {
        setError(response?.error || "Could not load breakout rooms.");
      }
    });

    return undefined;
  }, [enabled, onState, socket]);

  const handleCreate = (event) => {
    event.preventDefault();
    emitWithAcknowledgement(
      socket,
      "breakout:create",
      { name: roomName },
      setError
    );
    setRoomName("");
  };

  return (
    <section className="breakout-panel" aria-label="Breakout rooms">
      <header className="breakout-heading">
        <div>
          <h2>Breakout rooms</h2>
          <p>
            {isHost
              ? "You are the host. Assign participants to join a room."
              : currentRoom
                ? `You are in ${currentRoom.name}.`
                : participant?.assignedRoomId
                  ? "You have been assigned to a breakout room."
                  : "You are in the main Meeting Room."}
          </p>
        </div>
      </header>

      {!enabled ? (
        <p>Join the Meeting Room call to access breakout rooms.</p>
      ) : (
        <>
          {isHost && (
            <form className="breakout-create-form" onSubmit={handleCreate}>
              <label htmlFor="breakout-room-name">New room name</label>
              <input
                id="breakout-room-name"
                maxLength={40}
                required
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="e.g. Design discussion"
              />
              <button type="submit" disabled={!roomName.trim()}>
                Create room
              </button>
            </form>
          )}

          {state?.rooms.length ? (
            <div className="breakout-room-list">
              {state.rooms.map((room) => (
                <article className="breakout-room" key={room.id}>
                  <div className="breakout-room-heading">
                    <h3>{room.name}</h3>
                    {isHost && (
                      <button
                        type="button"
                        className="breakout-danger-button"
                        onClick={() =>
                          emitWithAcknowledgement(
                            socket,
                            "breakout:close",
                            { roomId: room.id },
                            setError
                          )
                        }
                      >
                        Close
                      </button>
                    )}
                  </div>

                  <ul>
                    {room.participants.map((member) => (
                      <li key={member.id}>
                        <span>
                          {member.name}
                          {member.breakoutRoomId === room.id
                            ? " · in room"
                            : " · assigned"}
                        </span>
                        {isHost && (
                          <button
                            type="button"
                            onClick={() =>
                              emitWithAcknowledgement(
                                socket,
                                "breakout:move-back",
                                { participantId: member.id },
                                setError
                              )
                            }
                          >
                            Move to main room
                          </button>
                        )}
                      </li>
                    ))}
                    {room.participants.length === 0 && (
                      <li className="breakout-empty">No participants assigned</li>
                    )}
                  </ul>

                  {!isHost &&
                    participant?.assignedRoomId === room.id &&
                    currentRoomId !== room.id && (
                      <button
                        type="button"
                        onClick={() =>
                          emitWithAcknowledgement(
                            socket,
                            "breakout:join",
                            { roomId: room.id },
                            setError
                          )
                        }
                      >
                        Join {room.name}
                      </button>
                    )}

                  {isHost && assignableParticipants.length > 0 && (
                    <div className="breakout-assign-form">
                      <label htmlFor={`breakout-assign-${room.id}`}>
                        Assign participant
                      </label>
                      <select
                        id={`breakout-assign-${room.id}`}
                        value={assignmentByParticipant[room.id] || ""}
                        onChange={(event) =>
                          setAssignmentByParticipant((current) => ({
                            ...current,
                            [room.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select a participant</option>
                        {assignableParticipants.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!assignmentByParticipant[room.id]}
                        onClick={() =>
                          emitWithAcknowledgement(
                            socket,
                            "breakout:assign",
                            {
                              participantId: assignmentByParticipant[room.id],
                              roomId: room.id,
                            },
                            setError
                          )
                        }
                      >
                        Assign
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p>No breakout rooms yet.</p>
          )}

          {!isHost && currentRoomId && (
            <button
              type="button"
              className="breakout-leave-button"
              onClick={() =>
                emitWithAcknowledgement(
                  socket,
                  "breakout:leave",
                  undefined,
                  setError
                )
              }
            >
              Leave breakout room
            </button>
          )}

          {currentRoom && (
            <BreakoutChat
              key={currentRoom.id}
              socket={socket}
              room={currentRoom}
              setError={setError}
            />
          )}
        </>
      )}
      {error && (
        <p className="breakout-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
