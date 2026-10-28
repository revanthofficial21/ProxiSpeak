// Runs the client smoke tests: bundles the JSX with esbuild, sets up jsdom, then
// executes the bundle. No test framework needed.
const path = require("path");
const { execFileSync } = require("child_process");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const bundle = path.join(__dirname, ".smoke.bundle.cjs");

execFileSync(
  path.join(root, "node_modules", ".bin", "esbuild"),
  [
    path.join(__dirname, "smoke.jsx"),
    "--bundle",
    "--format=cjs",
    "--platform=node",
    "--jsx=automatic",
    "--define:import.meta.env={}",
    "--define:fetch=globalThis.__testFetch",
    "--loader:.css=empty",
    "--loader:.svg=dataurl",
    "--loader:.png=dataurl",
    `--alias:socket.io-client=${path.join(__dirname, "mock-socket.js")}`,
    `--outfile=${bundle}`,
  ],
  { stdio: "inherit", cwd: root }
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = dom.window.requestAnimationFrame;
global.cancelAnimationFrame = dom.window.cancelAnimationFrame;
global.IS_REACT_ACT_ENVIRONMENT = true;

// The app fetches the room catalogue on mount; keep tests offline. The bundle is
// built with --define:fetch=globalThis.__testFetch, so every call lands here and
// node's real fetch (undici) is never touched.
globalThis.__testFetch = () =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({ rooms: [{ id: "open-world", name: "Open World" }] }),
  });
global.fetch = globalThis.__testFetch;

require(bundle);
