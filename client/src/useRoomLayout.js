import { useEffect, useRef, useState } from "react";
import { DEFAULT_LAYOUT } from "./office";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

// The furniture and zones for one room, fetched from the server.
//
// Falls back to the built-in layout, so a database outage degrades to the office
// everyone already knows rather than an empty world. `layoutRef` is the same value
// for callers that run outside React's render — the draw loop and the audio mixer.
export default function useRoomLayout(roomId) {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const layoutRef = useRef(DEFAULT_LAYOUT);

  useEffect(() => {
    if (!roomId) return undefined;

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `${SERVER_URL.replace(/\/$/, "")}/api/rooms/${encodeURIComponent(
            roomId
          )}/layout`
        );
        if (!response.ok) {
          throw new Error(`Layout request failed (${response.status})`);
        }

        const result = await response.json();
        if (cancelled || !result?.layout) return;

        layoutRef.current = result.layout;
        setLayout(result.layout);
      } catch (error) {
        console.warn("Using the built-in room layout:", error.message);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { layout, layoutRef };
}
