// A socket stub for the smoke tests — the app must not open a real connection.
export function io() {
  const handlers = new Map();
  const emitted = [];
  let notesState = { content: "", actionItems: [], updatedAt: null };
  const socket = {
    id: "test-player",
    connected: true,
    on(event, handler) {
      handlers.set(event, handler);
    },
    off(event) {
      handlers.delete(event);
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
            callback(null, { success: true, participants: [] });
          }
        },
      };
    },
    disconnect() {},
    __handlers: handlers,
    __emitted: emitted,
    __setMeetingNotesState(state) {
      notesState = state;
    },
  };
  globalThis.__testSocket = socket;
  return socket;
}
