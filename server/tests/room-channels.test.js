// A socket that joins a channel on connect must also leave it when it switches
// rooms. The two channel schemes (space:<name> and room:<id>) are both joined, and
// a merge that updates one but not the other leaks events between rooms — a player
// keeps receiving the room they walked out of.
//
// index.js starts a server and cannot be imported, so this checks the source
// directly. Cheap, and it catches exactly the omission that shipped.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

check(
  "the space channel is joined on connect",
  source.includes("socket.join(roomChannel(")
);

check(
  "the room-id channel is joined on connect",
  source.includes("socket.join(getRoomChannel(")
);

check(
  "the space channel is left when switching",
  source.includes("socket.leave(previousChannel)")
);

check(
  "the room-id channel is left when switching",
  source.includes("socket.leave(getRoomChannel(")
);

check(
  "the room-id channel is joined after switching",
  /onRoomChanged[\s\S]{0,400}socket\.join\(getRoomChannel\(/.test(source)
);

check(
  "no room-wide emit goes through a nullable channel unchecked",
  !/io\.to\(roomChannel\([^)]*\)\)\.emit/.test(source)
);

console.log(
  failures === 0
    ? "All room channel tests passed"
    : `${failures} room channel test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
