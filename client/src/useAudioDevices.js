import { useCallback, useEffect, useState } from "react";

// Lists the microphones and speakers the browser exposes.
//
// Labels only appear after microphone permission has been granted, so the list is
// refreshed whenever `active` flips — that is what turns "Microphone 1" into the
// real device name.
export default function useAudioDevices(active) {
  const [microphones, setMicrophones] = useState([]);
  const [speakers, setSpeakers] = useState([]);

  const refresh = useCallback(async () => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;

    try {
      const list = await mediaDevices.enumerateDevices();
      setMicrophones(list.filter((device) => device.kind === "audioinput"));
      setSpeakers(list.filter((device) => device.kind === "audiooutput"));
    } catch (error) {
      console.warn("Could not list audio devices:", error);
    }
  }, []);

  useEffect(() => {
    refresh();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return undefined;

    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, [refresh, active]);

  return { microphones, speakers, refresh };
}
