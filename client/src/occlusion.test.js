import {
  segmentIntersectsRect,
  isSoundBlocked,
  occlusionSettings,
  OCCLUDED_GAIN,
  OCCLUDED_LOWPASS_HZ,
  CLEAR_LOWPASS_HZ,
} from "./occlusion.js";

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

const rect = { x: 100, y: 100, width: 100, height: 100 };

check(
  "a segment crossing the rectangle is blocked",
  segmentIntersectsRect(0, 150, 300, 150, rect) === true
);

check(
  "a segment passing beside the rectangle is clear",
  segmentIntersectsRect(0, 50, 300, 50, rect) === false
);

check(
  "a segment ending inside the rectangle is blocked",
  segmentIntersectsRect(0, 150, 150, 150, rect) === true
);

check(
  "a segment entirely inside the rectangle is blocked",
  segmentIntersectsRect(120, 120, 180, 180, rect) === true
);

check(
  "a segment parallel to an edge and outside is clear",
  segmentIntersectsRect(0, 99, 300, 99, rect) === false
);

check(
  "a segment touching the edge counts as blocked",
  segmentIntersectsRect(0, 100, 300, 100, rect) === true
);

check(
  "a segment stopping short of the rectangle is clear",
  segmentIntersectsRect(0, 150, 99, 150, rect) === false
);

// --- isSoundBlocked -----------------------------------------------------

const obstacles = [rect];

check(
  "a wall between two players blocks sound",
  isSoundBlocked({ x: 0, y: 150 }, { x: 300, y: 150 }, obstacles) === true
);

check(
  "a clear line of sight does not block sound",
  isSoundBlocked({ x: 0, y: 20 }, { x: 300, y: 20 }, obstacles) === false
);

check(
  "an obstacle beyond the listener is ignored",
  isSoundBlocked({ x: 0, y: 150 }, { x: 50, y: 150 }, obstacles) === false
);

check(
  "no obstacles means never blocked",
  isSoundBlocked({ x: 0, y: 150 }, { x: 300, y: 150 }, []) === false
);

check(
  "missing positions are never blocked",
  isSoundBlocked(null, { x: 1, y: 1 }, obstacles) === false &&
    isSoundBlocked({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, obstacles) === false
);

// --- settings -----------------------------------------------------------

check(
  "an occluded peer is quieter and duller",
  occlusionSettings(true).gainScale === OCCLUDED_GAIN &&
    occlusionSettings(true).lowpassHz === OCCLUDED_LOWPASS_HZ
);

check(
  "a clear peer is full volume and unfiltered",
  occlusionSettings(false).gainScale === 1 &&
    occlusionSettings(false).lowpassHz === CLEAR_LOWPASS_HZ
);

console.log(
  failures === 0
    ? "All occlusion tests passed"
    : `${failures} occlusion test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
