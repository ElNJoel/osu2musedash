import { useEffect, useMemo, useState } from "react";
import type { DemoSelection } from "./types";
import { secondsLabel } from "./audioTools";

interface Props {
  audioFile: File | null;
  audioDurationS: number;
  defaultStartS: number;
  firstHitS: number;
  onAccept: (selection: DemoSelection) => void;
}

export function DemoEditor({ audioFile, audioDurationS, defaultStartS, firstHitS, onAccept }: Props) {
  const [startS, setStartS] = useState(defaultStartS);
  const [durationS, setDurationS] = useState(20);

  const url = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);

  useEffect(() => {
    setStartS(Math.min(Math.max(0, defaultStartS), Math.max(0, audioDurationS - 1)));
  }, [defaultStartS, audioDurationS]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const maxStart = Math.max(0, audioDurationS - 1);
  const maxDur = Math.max(1, audioDurationS - startS);
  const previewEnd = Math.min(audioDurationS, startS + durationS);

  if (!audioFile) {
    return <div className="emptyBox">Choose an audio file to trim demo.ogg.</div>;
  }

  return (
    <div className="panelSoft">
      <h3>Mandatory demo trim</h3>
      <p>Pick the exact preview section. This becomes <code>demo.ogg</code>.</p>

      {url && <audio className="audioPlayer" controls src={url} />}

      <div className="timePills">
        <span>Start: {secondsLabel(startS)}</span>
        <span>End: {secondsLabel(previewEnd)}</span>
        <span>Duration: {secondsLabel(durationS)}</span>
      </div>

      <label>
        Demo start
        <input
          type="range"
          min="0"
          max={maxStart}
          step="0.001"
          value={startS}
          onChange={(e) => setStartS(Number(e.target.value))}
        />
      </label>

      <label>
        Demo duration
        <input
          type="range"
          min="5"
          max={Math.min(45, maxDur)}
          step="0.5"
          value={Math.min(durationS, maxDur)}
          onChange={(e) => setDurationS(Number(e.target.value))}
        />
      </label>

      <div className="buttonRow">
        <button type="button" onClick={() => setStartS(Math.max(0, defaultStartS))}>
          Use osu! PreviewTime
        </button>
        <button type="button" onClick={() => setStartS(Math.max(0, firstHitS - 5))}>
          First hit - 5s
        </button>
        <button className="primary" type="button" onClick={() => onAccept({ startS, durationS: Math.min(durationS, maxDur) })}>
          Accept demo trim
        </button>
      </div>
    </div>
  );
}
