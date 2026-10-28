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
  check("the world toolbar renders", /2D proximity space/i.test(text));
  check("the people panel renders", /people online/i.test(text));

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
