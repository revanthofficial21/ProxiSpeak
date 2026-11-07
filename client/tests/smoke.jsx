// Smoke tests for the client: does the app render, and does entering the office
// actually start the world?
//
// Written against plain jsdom + react-dom rather than a test framework, so it runs
// anywhere Node does — including environments where the bundler cannot allocate
// WASM. Run it with `node tests/run.js`.
import { createRoot } from "react-dom/client";
import { act } from "react";
import App from "../src/App";

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

function findByText(container, pattern, selector = "button") {
  return [...container.querySelectorAll(selector)].find((node) =>
    pattern.test(node.textContent || "")
  );
}

async function main() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const canvasCalls = [];
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    canvasCalls.push(type);
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "canvas") return { width: 1000, height: 600 };
          if (prop === "measureText") return () => ({ width: 0 });
          return () => {};
        },
        set() {
          return true;
        },
      }
    );
  };

  const listened = [];
  const originalAdd = window.addEventListener.bind(window);
  window.addEventListener = (event, handler, options) => {
    listened.push(event);
    return originalAdd(event, handler, options);
  };

  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });

  // --- landing ----------------------------------------------------------
  check(
    "opens on the landing page",
    (container.textContent || "").includes("ProxiSpeak")
  );
  const cta = findByText(container, /enter the office/i);
  check("the landing has an Enter action", Boolean(cta));

  // --- entering the office ---------------------------------------------
  await act(async () => {
    cta.click();
  });

  const canvas = container.querySelector("canvas");
  check("the office canvas mounts after entering", Boolean(canvas));

  // The regression this guards: the draw loop ran once on mount, before the canvas
  // existed, and never re-ran — so the world stayed blank and the keys were dead.
  check("the canvas is asked for a 2D context", canvasCalls.includes("2d"));
  check(
    "movement keys are attached",
    listened.includes("keydown") && listened.includes("keyup")
  );

  // --- the world chrome -------------------------------------------------
  const text = container.textContent || "";
  check("the world toolbar renders", /shared space/i.test(text));
  check("the people panel renders", /people online/i.test(text));
  check(
    "one proximity voice panel provides the microphone controls",
    container.querySelectorAll(
      '.audio-panel[data-panel="office"] button'
    ).length === 1
  );

  const worldPlayers = [
    { id: "test-player", name: "Current Player", room: "Lounge" },
    { id: "player-two", name: "Second Player", room: "Lounge" },
    { id: "player-three", name: "Third Player", room: "Lounge" },
  ];
  act(() => {
    globalThis.__testSocket.__handlers.get("world:state")([worldPlayers[0]]);
  });
  check(
    "world:state updates the singular player count",
    container.querySelector(".count-label")?.textContent ===
      "Player in this space"
  );
  act(() => {
    globalThis.__testSocket.__handlers.get("player:joined")(worldPlayers[1]);
  });
  check(
    "player:joined updates player-count pluralization",
    container.querySelector(".count-label")?.textContent ===
      "Players in this space"
  );
  act(() => {
    globalThis.__testSocket.__handlers
      .get("world:state")(worldPlayers);
  });
  check(
    "world:state renders multiple players",
    worldPlayers.every((player) =>
      (container.textContent || "").includes(player.name)
    )
  );
  check(
    "world:state updates the player count",
    container.querySelector(".count-label")?.textContent ===
      "Players in this space"
  );
  act(() => {
    globalThis.__testSocket.__handlers.get("player:joined")({
      id: "player-four",
      name: "Fourth Player",
      room: "Lounge",
    });
  });
  check(
    "player:joined adds the player to the roster",
    container.textContent.includes("Fourth Player")
  );
  check(
    "player:joined updates the displayed count",
    container.querySelector(".count-number")?.textContent === "4"
  );
  act(() => {
    globalThis.__testSocket.__handlers.get("player:joined")({
      id: "other-room-player",
      name: "Other Room Player",
      room: "Focus Space",
    });
  });
  check(
    "player:joined ignores players in other rooms",
    !container.textContent.includes("Other Room Player")
  );

  act(() => {
    globalThis.__testSocket.__handlers.get("connect")();
  });
  const worldChat = container.querySelector(
    '.chat-panel[data-panel="chat"]'
  );
  const roomChat = container.querySelector('aside.chat-panel');
  const worldChatInput = worldChat.querySelector("input");
  const roomChatInput = roomChat.querySelector("input");
  const setInputValue = (input, value) => {
    Object.getOwnPropertyDescriptor(
      input instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : input instanceof window.HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype,
      "value"
    ).set.call(input, value);
    input.dispatchEvent(
      new window.Event(
        input instanceof window.HTMLSelectElement ? "change" : "input",
        { bubbles: true }
      )
    );
  };

  await act(async () => {
    setInputValue(worldChatInput, "World hello");
  });
  await act(async () => {
    worldChat.querySelector("form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true })
    );
  });
  check(
    "World Chat Send emits the world chat event",
    globalThis.__testSocket.__emitted.some(
      ({ event }) => event === "world-chat:send"
    )
  );

  act(() => {
    globalThis.__testSocket.__handlers.get("chat:message")({
      id: "test-player-1",
      senderName: "Current Player",
      text: "World hello",
      room: "Lounge",
      scope: "world",
    });
  });
  check(
    "string-id world messages render in World Chat",
    worldChat.textContent.includes("World hello") &&
      !roomChat.textContent.includes("World hello")
  );

  await act(async () => {
    setInputValue(roomChatInput, "Room hello");
  });
  await act(async () => {
    roomChat.querySelector("form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true })
    );
  });
  check(
    "room chat Send emits the room chat event",
    globalThis.__testSocket.__emitted.some(
      ({ event }) => event === "chat:send"
    )
  );

  act(() => {
    globalThis.__testSocket.__handlers.get("chat:message")({
      id: "test-player-2",
      senderName: "Second Player",
      text: "Room hello",
      room: "Lounge",
      scope: "room",
    });
  });
  check(
    "room messages render only in the active room chat",
    roomChat.textContent.includes("Room hello") &&
      !worldChat.textContent.includes("Room hello")
  );
  act(() => {
    globalThis.__testSocket.__handlers.get("chat:message")({
      id: "test-player-3",
      senderName: "Meeting Player",
      text: "Private meeting message",
      room: "Meeting Room",
      scope: "room",
    });
  });
  check(
    "messages from another room are not rendered",
    !roomChat.textContent.includes("Private meeting message") &&
      !worldChat.textContent.includes("Private meeting message")
  );
  act(() => {
    globalThis.__testSocket.__handlers.get("room:state")({
      room: "Meeting Room",
      players: [],
    });
  });
  act(() => {
    globalThis.__testSocket.__handlers.get("chat:message")({
      id: "test-player-4",
      senderName: "Meeting Player",
      text: "Meeting Room hello",
      room: "Meeting Room",
      scope: "room",
    });
  });
  check(
    "Meeting Room messages render in Meeting Room Chat",
    roomChat.getAttribute("aria-label") === "Meeting Room chat" &&
      roomChat.textContent.includes("Meeting Room hello") &&
      worldChat.textContent.includes("World hello")
  );

  const meetingRoomCard = [...container.querySelectorAll(".room-card")].find(
    (button) => button.textContent.includes("Meeting Room")
  );
  await act(async () => meetingRoomCard.click());
  const meetingRoomJoin = container.querySelector(
    ".rooms-panel .room-button"
  );
  await act(async () => meetingRoomJoin.click());
  act(() => {
    globalThis.__testSocket.__handlers.get("meeting:hand")({
      id: "player-two",
      name: "Second Player",
      raised: true,
    });
  });
  check(
    "raised hands appear beside participant names",
    container.querySelector(".rooms-panel .meeting-hand-indicator")
      ?.textContent === " ✋"
  );

  act(() => {
    globalThis.__testSocket.__handlers.get("meeting:reaction")({
      id: "player-two",
      name: "Second Player",
      emoji: "👏",
    });
  });
  check(
    "meeting reactions display on the Meeting Room screen",
    container.querySelector(".meeting-reaction-pop")?.textContent ===
      "👏Second Player"
  );
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 2700));
  });
  check(
    "meeting reactions disappear automatically",
    !container.querySelector(".meeting-reaction-pop")
  );

  check(
    "meeting notes require joining the call",
    container.querySelector(".meeting-notes")?.textContent.includes(
      "Join the Meeting Room call"
    )
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => ({
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      }),
    },
  });
  await act(async () => {
    container.querySelector(".meeting-panel-heading button").click();
  });
  const notesPanel = container.querySelector(".meeting-notes");
  check(
    "joining the Meeting Room call loads shared notes",
    notesPanel?.querySelector("#meeting-notes-content") &&
      globalThis.__testSocket.__emitted.some(
        ({ event }) => event === "meeting:notes:load"
      )
  );

  const sharedState = {
    content: "Decide launch date",
    actionItems: [
      {
        id: "action-one",
        title: "Share meeting recap",
        assignee: "Player test",
        dueDate: "2026-11-30",
        completed: false,
      },
    ],
    updatedAt: "2026-11-07T00:00:00.000Z",
  };
  globalThis.__testSocket.__setMeetingNotesState(sharedState);
  act(() => {
    globalThis.__testSocket.__handlers.get("meeting:notes:state")(sharedState);
  });
  check(
    "server note and action updates render for meeting participants",
    notesPanel.querySelector("#meeting-notes-content").value ===
      "Decide launch date" &&
      notesPanel.textContent.includes("Share meeting recap") &&
      notesPanel.textContent.includes("Due 2026-11-30")
  );

  const notesInput = notesPanel.querySelector("#meeting-notes-content");
  await act(async () => setInputValue(notesInput, "Updated launch decision"));
  await act(async () => {
    notesPanel.querySelector("form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true })
    );
  });
  check(
    "editing and saving shared notes emits the validated notes event",
    globalThis.__testSocket.__emitted.some(
      ({ event, args }) =>
        event === "meeting:notes:update" &&
        args[0]?.content === "Updated launch decision"
    )
  );

  await act(async () => {
    setInputValue(
      notesPanel.querySelector("#meeting-action-title"),
      "Send follow-up"
    );
    setInputValue(
      notesPanel.querySelector("#meeting-action-assignee"),
      "Player test"
    );
    setInputValue(
      notesPanel.querySelector("#meeting-action-due-date"),
      "2026-12-01"
    );
  });
  await act(async () => {
    notesPanel.querySelectorAll("form")[1].dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true })
    );
  });
  check(
    "creating an action item sends title, assignee, and optional due date",
    globalThis.__testSocket.__emitted.some(
      ({ event, args }) =>
        event === "meeting:action:create" &&
        args[0]?.title === "Send follow-up" &&
        args[0]?.assignee === "Player test" &&
        args[0]?.dueDate === "2026-12-01"
    )
  );

  const completionCheckbox = notesPanel.querySelector(
    'input[type="checkbox"]'
  );
  await act(async () => completionCheckbox.click());
  check(
    "action items can be marked completed or pending",
    globalThis.__testSocket.__emitted.some(
      ({ event, args }) =>
        event === "meeting:action:update" &&
        args[0]?.id === "action-one" &&
        args[0]?.completed === true
    )
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();

  console.log(
    failures === 0
      ? "All client smoke tests passed"
      : `${failures} client smoke test(s) failed`
  );
  // jsdom's visual timers and the app's animation loop keep the event loop alive,
  // so the process has to be ended explicitly.
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FAIL - smoke tests threw:", error);
  process.exit(1);
});
