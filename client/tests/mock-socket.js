// A socket stub for the smoke tests — the app must not open a real connection.
export function io() {
  const handlers = new Map();
  return {
    id: "test-player",
    connected: true,
    on(event, handler) {
      handlers.set(event, handler);
    },
    off(event) {
      handlers.delete(event);
    },
    emit() {},
    timeout() {
      return { emit() {} };
    },
    disconnect() {},
    __handlers: handlers,
  };
}
