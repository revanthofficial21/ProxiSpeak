import { useCallback, useEffect, useRef, useState } from "react";

function isMeetingNotesState(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.content === "string" &&
      Array.isArray(value.actionItems) &&
      value.actionItems.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.assignee === "string" &&
          (item.dueDate === null || typeof item.dueDate === "string") &&
          typeof item.completed === "boolean"
      )
  );
}

export default function MeetingNotes({
  socket,
  enabled,
  playerName,
  participants,
}) {
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [actionItems, setActionItems] = useState([]);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const savedNotesRef = useRef("");
  const notesDirtyRef = useRef(false);

  const assignees = [
    playerName?.trim() ||
      (socket?.id ? `Player ${socket.id.slice(0, 4)}` : "You"),
    ...participants.map((participant) => participant.name),
  ]
    .map((name) => name?.trim())
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index);

  const applyState = useCallback((state) => {
    if (!isMeetingNotesState(state)) return;
    savedNotesRef.current = state.content;
    setSavedNotes(state.content);
    if (!notesDirtyRef.current) setNotes(state.content);
    setActionItems(state.actionItems);
  }, []);

  useEffect(() => {
    if (!socket || !enabled) return undefined;

    const handleState = (state) => applyState(state);
    socket.on("meeting:notes:state", handleState);
    socket.emit("meeting:notes:load", (response) => {
      if (response?.success && isMeetingNotesState(response.state)) {
        applyState(response.state);
        setError("");
      } else {
        setError(response?.error || "Could not load meeting notes.");
      }
    });

    return () => socket.off("meeting:notes:state", handleState);
  }, [applyState, enabled, socket]);

  const submitNotes = (event) => {
    event.preventDefault();
    if (!socket || notes.length > 10000) return;
    socket.emit("meeting:notes:update", { content: notes }, (response) => {
      if (response?.success && isMeetingNotesState(response.state)) {
        notesDirtyRef.current = false;
        applyState(response.state);
        setError("");
      } else {
        setError(response?.error || "Could not save meeting notes.");
      }
    });
  };

  const submitActionItem = (event) => {
    event.preventDefault();
    if (!socket || !title.trim() || !assignee) return;
    socket.emit(
      "meeting:action:create",
      { title, assignee, dueDate: dueDate || null },
      (response) => {
        if (response?.success && isMeetingNotesState(response.state)) {
          applyState(response.state);
          setTitle("");
          setDueDate("");
          setError("");
        } else {
          setError(response?.error || "Could not create action item.");
        }
      }
    );
  };

  const setActionCompleted = (item, completed) => {
    if (!socket) return;
    socket.emit(
      "meeting:action:update",
      { id: item.id, completed },
      (response) => {
        if (response?.success && isMeetingNotesState(response.state)) {
          applyState(response.state);
          setError("");
        } else {
          setError(response?.error || "Could not update action item.");
        }
      }
    );
  };

  return (
    <section className="meeting-notes" aria-label="Meeting notes and action items">
      <h2>Meeting notes &amp; action items</h2>
      {!enabled ? (
        <p>Join the Meeting Room call to view and edit shared notes.</p>
      ) : (
        <>
          <form onSubmit={submitNotes}>
            <label htmlFor="meeting-notes-content">Shared notes</label>
            <textarea
              id="meeting-notes-content"
              maxLength={10000}
              rows={6}
              value={notes}
              onChange={(event) => {
                notesDirtyRef.current =
                  event.target.value !== savedNotesRef.current;
                setNotes(event.target.value);
              }}
              placeholder="Capture decisions and discussion points..."
            />
            <button type="submit" disabled={notes === savedNotes}>
              Save notes
            </button>
          </form>

          <div className="meeting-action-items">
            <h3>Action items</h3>
            {actionItems.length === 0 ? (
              <p>No action items yet.</p>
            ) : (
              <ul>
                {actionItems.map((item) => (
                  <li
                    className={item.completed ? "is-completed" : ""}
                    key={item.id}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(event) =>
                          setActionCompleted(item, event.target.checked)
                        }
                      />
                      <span>{item.title}</span>
                    </label>
                    <span>Assigned to {item.assignee}</span>
                    {item.dueDate && (
                      <time dateTime={item.dueDate}>Due {item.dueDate}</time>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={submitActionItem}>
              <label htmlFor="meeting-action-title">Action item title</label>
              <input
                id="meeting-action-title"
                maxLength={160}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <label htmlFor="meeting-action-assignee">Assignee</label>
              <select
                id="meeting-action-assignee"
                required
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">Select a participant</option>
                {assignees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <label htmlFor="meeting-action-due-date">Due date (optional)</label>
              <input
                id="meeting-action-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <button type="submit" disabled={!title.trim() || !assignee}>
                Add action item
              </button>
            </form>
          </div>
        </>
      )}
      {error && (
        <p className="meeting-notes-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
