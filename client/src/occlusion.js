// Sound occlusion: furniture standing between two players muffles their voices.
//
// This is the piece almost no spatial-audio product does — it makes the office
// architecture matter instead of being decoration. Pure geometry, no dependencies,
// so it can be tested without a browser.

// How much of the signal survives behind an obstacle.
export const OCCLUDED_GAIN = 0.35;

// Low-pass cutoffs: open air passes everything, an obstacle dulls the voice the
// way a wall does.
export const CLEAR_LOWPASS_HZ = 20000;
export const OCCLUDED_LOWPASS_HZ = 800;

// Liang–Barsky segment/rectangle clipping: true when the segment crosses the
// rectangle at all. Touching an edge counts as crossing.
export function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  if (!rect) return false;

  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  // Clip the segment parameter range [t0, t1] against each edge in turn.
  const clip = (p, q) => {
    if (p === 0) return q >= 0; // parallel to this edge: inside only if q >= 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (!clip(-dx, x1 - rect.x)) return false;
  if (!clip(dx, rect.x + rect.width - x1)) return false;
  if (!clip(-dy, y1 - rect.y)) return false;
  if (!clip(dy, rect.y + rect.height - y1)) return false;

  return true;
}

// True when any obstacle stands on the straight line between the two points.
export function isSoundBlocked(from, to, obstacles) {
  if (!from || !to) return false;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return false;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  if (!Array.isArray(obstacles)) return false;

  return obstacles.some((rect) =>
    segmentIntersectsRect(from.x, from.y, to.x, to.y, rect)
  );
}

// The gain and low-pass a peer should get, given whether they are occluded.
export function occlusionSettings(blocked) {
  return blocked
    ? { gainScale: OCCLUDED_GAIN, lowpassHz: OCCLUDED_LOWPASS_HZ }
    : { gainScale: 1, lowpassHz: CLEAR_LOWPASS_HZ };
}
