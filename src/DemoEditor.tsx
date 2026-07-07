import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DemoSelection } from "./types";
import { secondsLabel } from "./audioTools";

interface Props {
  audioFile: File | null;
  audioDurationS: number;
  defaultStartS: number;
  firstHitS: number;
  onAccept: (selection: DemoSelection) => void;
}

type DragMode = "start" | "end" | "move" | "none";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

async function buildPeaks(file: File, buckets = 900): Promise<number[]> {
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = i * block;
      const end = Math.min(channel.length, start + block);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    const max = Math.max(...peaks, 0.0001);
    return peaks.map((p) => p / max);
  } finally {
    try { await audioContext.close(); } catch {}
  }
}

export function DemoEditor({ audioFile, audioDurationS, defaultStartS, firstHitS, onAccept }: Props) {
  const [startS, setStartS] = useState(defaultStartS);
  const [durationS, setDurationS] = useState(20);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveStatus, setWaveStatus] = useState("Waiting for audio...");
  const [dragMode, setDragMode] = useState<DragMode>("none");
  const [dragOffsetS, setDragOffsetS] = useState(0);
  const [playheadS, setPlayheadS] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const url = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);

  useEffect(() => {
    setStartS(Math.min(Math.max(0, defaultStartS), Math.max(0, audioDurationS - 1)));
  }, [defaultStartS, audioDurationS]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (!audioFile) {
      setPeaks([]);
      setWaveStatus("Waiting for audio...");
      return;
    }
    let cancelled = false;
    setWaveStatus("Drawing waveform...");
    buildPeaks(audioFile)
      .then((p) => {
        if (cancelled) return;
        setPeaks(p);
        setWaveStatus("Waveform ready. Drag the orange handles or drag the teal block.");
      })
      .catch(() => {
        if (cancelled) return;
        setPeaks([]);
        setWaveStatus("Could not decode waveform. Sliders still work.");
      });
    return () => { cancelled = true; };
  }, [audioFile]);

  const maxStart = Math.max(0, audioDurationS - 1);
  const safeDuration = Math.min(durationS, Math.max(1, audioDurationS - startS));
  const endS = Math.min(audioDurationS, startS + safeDuration);

  function xToSeconds(x: number, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    const px = clamp(x - rect.left, 0, rect.width);
    return (px / rect.width) * audioDurationS;
  }

  function drawWaveform() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#111827");
    grad.addColorStop(1, "#0b1220");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const gridColor = "rgba(255,255,255,0.06)";
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const x = (w / 6) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const mid = h / 2;
    const barW = Math.max(1, w / Math.max(1, peaks.length));
    ctx.fillStyle = "#475569";

    if (peaks.length) {
      peaks.forEach((p, i) => {
        const bh = Math.max(2, p * (h * 0.38));
        ctx.fillRect(i * barW, mid - bh, Math.max(1, barW - 1), bh * 2);
      });
    }

    const sx = (startS / audioDurationS) * w;
    const ex = (endS / audioDurationS) * w;

    ctx.fillStyle = "rgba(45, 212, 191, 0.18)";
    ctx.fillRect(sx, 0, Math.max(2, ex - sx), h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, 0, Math.max(2, ex - sx), h);
    ctx.clip();
    ctx.fillStyle = "#2dd4bf";
    if (peaks.length) {
      peaks.forEach((p, i) => {
        const x = i * barW;
        if (x < sx - 2 || x > ex + 2) return;
        const bh = Math.max(2, p * (h * 0.38));
        ctx.fillRect(x, mid - bh, Math.max(1, barW - 1), bh * 2);
      });
    }
    ctx.restore();

    ctx.fillStyle = "#fb923c";
    ctx.fillRect(sx - 2, 0, 4, h);
    ctx.fillRect(ex - 2, 0, 4, h);

    const handleW = 10;
    const handleH = 38;
    ctx.fillStyle = "#f97316";
    ctx.fillRect(sx - handleW / 2, h/2 - handleH/2, handleW, handleH);
    ctx.fillRect(ex - handleW / 2, h/2 - handleH/2, handleW, handleH);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(secondsLabel(startS), clamp(sx + 10, 8, w - 92), 22);
    ctx.fillText(secondsLabel(endS), clamp(ex - 76, 8, w - 76), h - 12);

    const firstX = (firstHitS / audioDurationS) * w;
    if (firstX >= 0 && firstX <= w) {
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(firstX, 0);
      ctx.lineTo(firstX, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#c4b5fd";
      ctx.fillText("first hit", clamp(firstX + 6, 8, w - 70), h - 30);
    }

    const playX = (playheadS / Math.max(0.001, audioDurationS)) * w;
    if (playX >= 0 && playX <= w) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, h);
      ctx.stroke();
    }
  }

  useEffect(() => {
    drawWaveform();
  }, [peaks, startS, durationS, audioDurationS, firstHitS, playheadS]);

  useEffect(() => {
    const onResize = () => drawWaveform();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [peaks, startS, durationS, playheadS]);

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) setPlayheadS(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || audioDurationS <= 0) return;
    const t = xToSeconds(e.clientX, canvas);
    const edgeThreshold = Math.max(0.5, audioDurationS * 0.008);

    if (Math.abs(t - startS) <= edgeThreshold) {
      setDragMode("start");
    } else if (Math.abs(t - endS) <= edgeThreshold) {
      setDragMode("end");
    } else if (t > startS && t < endS) {
      setDragMode("move");
      setDragOffsetS(t - startS);
    } else {
      const nextStart = clamp(t, 0, Math.max(0, audioDurationS - safeDuration));
      setStartS(nextStart);
      setDragMode("start");
    }
    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (dragMode === "none") return;
    const canvas = canvasRef.current;
    if (!canvas || audioDurationS <= 0) return;
    const t = xToSeconds(e.clientX, canvas);

    if (dragMode === "start") {
      const nextStart = clamp(t, 0, Math.max(0, endS - 1));
      setDurationS(Math.max(1, endS - nextStart));
      setStartS(nextStart);
    } else if (dragMode === "end") {
      const nextEnd = clamp(t, startS + 1, audioDurationS);
      setDurationS(nextEnd - startS);
    } else if (dragMode === "move") {
      const nextStart = clamp(t - dragOffsetS, 0, Math.max(0, audioDurationS - safeDuration));
      setStartS(nextStart);
    }
  }

  function playSelected() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startS;
    setPlayheadS(startS);
    audio.play().catch(() => undefined);
  }

  function stopPlaybackAtEnd() {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayheadS(audio.currentTime);
    if (audio.currentTime >= endS) {
      audio.pause();
      audio.currentTime = startS;
      setPlayheadS(startS);
    }
  }

  if (!audioFile) {
    return <div className="emptyBox">Choose an audio file to trim demo.ogg.</div>;
  }

  return (
    <div className="demoEditor">
      <div className="demoTopRow">
        <div>
          <h3>Mandatory demo trim</h3>
          <p>Drag the waveform and audition the selected preview before accepting.</p>
        </div>
        <div className="demoStatsGrid">
          <div className="statPill"><span>Start</span><strong>{secondsLabel(startS)}</strong></div>
          <div className="statPill"><span>End</span><strong>{secondsLabel(endS)}</strong></div>
          <div className="statPill"><span>Length</span><strong>{secondsLabel(safeDuration)}</strong></div>
        </div>
      </div>

      {url && <audio ref={audioRef} className="audioPlayer" controls src={url} onTimeUpdate={stopPlaybackAtEnd} />}

      <canvas
        ref={canvasRef}
        className="waveCanvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragMode("none")}
        onPointerCancel={() => setDragMode("none")}
      />

      <p className="waveStatus">{waveStatus}</p>

      <div className="quickActionsRow">
        <button type="button" onClick={() => setStartS(Math.max(0, defaultStartS))}>Use osu! PreviewTime</button>
        <button type="button" onClick={() => setStartS(Math.max(0, firstHitS - 5))}>First hit - 5s</button>
        <button type="button" onClick={() => setDurationS(15)}>15s</button>
        <button type="button" onClick={() => setDurationS(20)}>20s</button>
        <button type="button" onClick={() => setDurationS(30)}>30s</button>
        <button type="button" onClick={playSelected}>Play selected demo</button>
      </div>

      <div className="demoFineGrid">
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
            max={Math.min(45, Math.max(5, audioDurationS - startS))}
            step="0.5"
            value={Math.min(durationS, Math.max(5, audioDurationS - startS))}
            onChange={(e) => setDurationS(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="buttonRow">
        <button className="primary" type="button" onClick={() => onAccept({ startS, durationS: safeDuration })}>
          Accept demo trim
        </button>
      </div>
    </div>
  );
}
