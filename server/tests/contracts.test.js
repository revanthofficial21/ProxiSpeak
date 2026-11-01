// Static contract check: every payload field the client destructures from a
// server event must exist in what the server actually sends.
//
// This is the class of bug that shipped once already — screen:list sent `room`
// while the client read `roomId` — and it is invisible to unit tests on either
// side alone, because each side is self-consistent. Cheap, and it catches the
// whole family: renamed fields, dropped fields, typos.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function walk(dir, pattern, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, pattern, out);
    } else if (pattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const serverFiles = walk(path.join(ROOT, "server"), /\.js$/).filter(
  (file) => !file.includes(`${path.sep}tests${path.sep}`) && !file.includes(".test.")
);
const clientFiles = walk(path.join(ROOT, "client", "src"), /\.(jsx?|mjs)$/);

const serverSource = serverFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const clientSource = clientFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

// Every emit("event", { ... }) — collect the top-level payload keys by tracking
// brace depth, so nested object literals don't confuse the parse.
const emitted = new Map();
for (const match of serverSource.matchAll(/emit\("([a-z:]+)",\s*\{/g)) {
  const event = match[1];
  let index = match.index + match[0].length;
  let depth = 1;
  let body = "";
  while (index < serverSource.length && depth > 0) {
    const char = serverSource[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth > 0) body += char;
    index += 1;
  }
  const keys = [...body.matchAll(/(?:^|,)\s*([a-zA-Z_]\w*)\s*:/g)].map(
    (m) => m[1]
  );
  const variants = emitted.get(event) || new Set();
  variants.add(keys.join(","));
  emitted.set(event, variants);
}

// Every .on("event", ({ a, b } = {}) => ...) on the client.
const handled = new Map();
for (const match of clientSource.matchAll(
  /\.on\("([a-z:]+)",\s*(?:async\s*)?\(\{([^}]*)\}/g
)) {
  const event = match[1];
  // Handle renames: { status: nextStatus } destructures the `status` key.
  const keys = match[2]
    .split("=")[0]
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter(Boolean);
  handled.set(event, keys);
}

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

check("found server source", serverSource.length > 0);
check("found client source", clientSource.length > 0);
check("found emitted events", emitted.size > 0);
check("found client handlers", handled.size > 0);

let compared = 0;
for (const [event, wanted] of handled) {
  const variants = emitted.get(event);
  if (!variants) continue; // client listens to something the server never sends
  compared += 1;

  const satisfied = [...variants].some((variant) => {
    const provided = new Set(variant.split(",").filter(Boolean));
    return wanted.every((key) => provided.has(key));
  });

  if (!satisfied) {
    failures += 1;
    console.error(
      `FAIL - ${event}: client reads [${wanted.join(", ")}] but server sends [${
        [...variants].join(" | ")
      }]`
    );
  }
}

check(`compared ${compared} client/server event payloads`, compared > 0);

console.log(
  failures === 0
    ? "All contract tests passed"
    : `${failures} contract test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
