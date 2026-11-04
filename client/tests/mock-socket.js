// A socket stub for the smoke tests — the app must not open a real connection.
export function io() {
  const handlers = new Map();
  const emitted = [];
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
        const response =
          event === "player:joinRoom"
            ? { success: true, room: args[0] }
            : event === "meeting:join"
              ? {
                  success: true,
                  participants: [
                    {
                      id: "player-two",
                      name: "Second Player",
                      handRaised: false,
                    },
                  ],
                }
              : { success: true };
        callback(response);
      }
    },
    timeout() {
      return { emit() {} };
    },
    disconnect() {},
    __handlers: handlers,
    __emitted: emitted,
  };
  globalThis.__testSocket = socket;
  return socket;
}
