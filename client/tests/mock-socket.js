// A socket stub for the smoke tests — the app must not open a real connection.
export function io() {
  const handlers = new Map();
  const emitted = [];
  let notesState = { content: "", actionItems: [], updatedAt: null };
  let breakoutState = { hostId: null, participants: [], rooms: [] };
  const dispatch = (event, ...args) => {
    for (const handler of handlers.get(event) || []) handler(...args);
  };
  const publishBreakoutState = () => {
    dispatch("breakout:state", breakoutState);
  };
  const socket = {
    id: "test-player",
    connected: true,
    on(event, handler) {
      const listeners = handlers.get(event) || [];
      listeners.push(handler);
      handlers.set(event, listeners);
    },
    off(event, handler) {
      if (!handler) {
        handlers.delete(event);
        return;
      }
      const listeners = handlers.get(event) || [];
      const remaining = listeners.filter((listener) => listener !== handler);
      if (remaining.length) handlers.set(event, remaining);
      else handlers.delete(event);
    },
    removeAllListeners() {
      handlers.clear();
    },
    emit(event, ...args) {
      emitted.push({ event, args });
      const callback = args.find((argument) => typeof argument === "function");
      if (callback) {
        let response = { success: true };
        if (event === "player:joinRoom") {
          response = { success: true, room: args[0] };
        } else if (event === "meeting:notes:load") {
          response = { success: true, state: notesState };
        } else if (event === "meeting:notes:update") {
          notesState = { ...notesState, content: args[0].content };
          response = { success: true, state: notesState };
        } else if (event === "meeting:action:create") {
          notesState = {
            ...notesState,
            actionItems: [
              ...notesState.actionItems,
              {
                id: "created-action",
                ...args[0],
                completed: false,
              },
            ],
          };
          response = { success: true, state: notesState };
        } else if (event === "meeting:action:update") {
          notesState = {
            ...notesState,
            actionItems: notesState.actionItems.map((item) =>
              item.id === args[0].id
                ? { ...item, completed: args[0].completed }
                : item
            ),
          };
          response = { success: true, state: notesState };
        } else if (event === "breakout:load") {
          response = { success: true, state: breakoutState };
        } else if (event === "breakout:create") {
          const room = {
            id: `breakout-${breakoutState.rooms.length + 1}`,
            name: args[0].name.trim(),
            participants: [
              {
                id: "player-two",
                name: "Second Player",
                handRaised: false,
              },
            ],
          };
          breakoutState = {
            ...breakoutState,
            rooms: [...breakoutState.rooms, room],
          };
          response = { success: true, roomId: room.id, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:assign") {
          breakoutState = {
            ...breakoutState,
            participants: breakoutState.participants.map((participant) =>
              participant.id === args[0].participantId
                ? { ...participant, assignedRoomId: args[0].roomId }
                : participant
            ),
          };
          breakoutState.rooms = breakoutState.rooms.map((room) => ({
            ...room,
            participants: breakoutState.participants.filter(
              (participant) => participant.assignedRoomId === room.id
            ),
          }));
          response = { success: true, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:join") {
          breakoutState = {
            ...breakoutState,
            participants: breakoutState.participants.map((participant) =>
              participant.id === socket.id
                ? { ...participant, breakoutRoomId: args[0].roomId }
                : participant
            ),
          };
          response = { success: true, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:leave") {
          breakoutState = {
            ...breakoutState,
            participants: breakoutState.participants.map((participant) =>
              participant.id === socket.id
                ? {
                    ...participant,
                    assignedRoomId: null,
                    breakoutRoomId: null,
                  }
                : participant
            ),
          };
          response = { success: true, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:move-back") {
          breakoutState = {
            ...breakoutState,
            participants: breakoutState.participants.map((participant) =>
              participant.id === args[0].participantId
                ? {
                    ...participant,
                    assignedRoomId: null,
                    breakoutRoomId: null,
                  }
                : participant
            ),
          };
          breakoutState.rooms = breakoutState.rooms.map((room) => ({
            ...room,
            participants: breakoutState.participants.filter(
              (participant) => participant.assignedRoomId === room.id
            ),
          }));
          response = { success: true, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:close") {
          breakoutState = {
            ...breakoutState,
            rooms: breakoutState.rooms.filter(
              (room) => room.id !== args[0].roomId
            ),
            participants: breakoutState.participants.map((participant) =>
              participant.assignedRoomId === args[0].roomId
                ? {
                    ...participant,
                    assignedRoomId: null,
                    breakoutRoomId: null,
                  }
                : participant
            ),
          };
          response = { success: true, state: breakoutState };
          publishBreakoutState();
        } else if (event === "breakout:chat:send") {
          response = { success: true };
        }
        callback(response);
      }
    },
    timeout() {
      return {
        emit(event, ...args) {
          emitted.push({ event, args });
          const callback = args.find(
            (argument) => typeof argument === "function"
          );
          if (event === "meeting:join" && callback) {
            breakoutState = {
              hostId: socket.id,
              participants: [
                {
                  id: socket.id,
                  name: "Current Player",
                  isHost: true,
                  assignedRoomId: null,
                  breakoutRoomId: null,
                },
                {
                  id: "player-two",
                  name: "Second Player",
                  isHost: false,
                  assignedRoomId: null,
                  breakoutRoomId: null,
                },
              ],
              rooms: [],
            };
            callback(null, {
              success: true,
              participants: [],
              breakoutState,
            });
          }
        },
      };
    },
    disconnect() {},
    __handlers: {
      get(event) {
        if (!handlers.has(event)) return undefined;
        return (...args) => dispatch(event, ...args);
      },
    },
    __emitted: emitted,
    __setMeetingNotesState(state) {
      notesState = state;
    },
    __setBreakoutState(state) {
      breakoutState = state;
      publishBreakoutState();
    },
  };
  globalThis.__testSocket = socket;
  return socket;
}
