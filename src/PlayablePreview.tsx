import { useEffect, useMemo, useRef, useState } from "react";
import type { HitObject, LanePolicy, OsuBeatmap } from "./types";

interface Props {
  beatmap: OsuBeatmap;
  audioFile: File | null;
  lanePolicy: LanePolicy;
}

type Lane = "up" | "down";

interface PlayNote {
  id: number;
  timeS: number;
  lane: Lane;
  hit: boolean;
  missed: boolean;
}

function laneForObject(obj: HitObject, index: number, policy: LanePolicy): Lane {
  if (policy === "alternate") return index % 2 === 0 ? "down" : "up";
  if (policy === "xy") return obj.y < 192 ? "up" : "down";
  if (policy === "hitsound") return obj.taikoColor === "kat" || obj.hasWhistle || obj.hasClap ? "up" : "down";

  // auto
  if (obj.hasWhistle || obj.hasClap || obj.taikoColor === "kat") return "up";
  if (obj.y < 192) return "up";
  return "down";
}

function buildPreviewNotes(beatmap: OsuBeatmap, lanePolicy: LanePolicy): PlayNote[] {
  return beatmap.hitObjects
    .filter((obj) => obj.isCircle || obj.isSlider || obj.isSpinner)
    .map((obj, index) => ({
      id: index,
      timeS: obj.timeMs / 1000,
      lane: laneForObject(obj, index, lanePolicy),
      hit: false,
      missed: false
    }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PlayablePreview({ beatmap, audioFile, lanePolicy }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const notesRef = useRef<PlayNote[]>([]);
  const [notes, setNotes] = useState<PlayNote[]>([]);
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [hitFlash, setHitFlash] = useState<Lane | null>(null);
  const [lastJudgement, setLastJudgement] = useState("Ready");

  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    const fresh = buildPreviewNotes(beatmap, lanePolicy);
    setNotes(fresh);
    notesRef.current = fresh.map((n) => ({ ...n }));
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setAccuracy(100);
    setLastJudgement("Ready");
  }, [beatmap.id, lanePolicy]);

  function resetGame(startAtFirstHit = true) {
    const fresh = buildPreviewNotes(beatmap, lanePolicy);
    notesRef.current = fresh.map((n) => ({ ...n }));
    setNotes(fresh);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setAccuracy(100);
    setLastJudgement("Ready");
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      const start = startAtFirstHit ? Math.max(0, beatmap.firstHitMs / 1000 - 2) : 0;
      audio.currentTime = start;
    }
    setPlaying(false);
  }

  function recalcAccuracy() {
    const all = notesRef.current;
    const judged = all.filter((n) => n.hit || n.missed).length;
    const hit = all.filter((n) => n.hit).length;
    if (!judged) {
      setAccuracy(100);
      return;
    }
    setAccuracy(Math.round((hit / judged) * 100));
  }

  function hitLane(lane: Lane) {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    const now = audio.currentTime;
    const hitWindow = 0.18;

    let bestIndex = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < notesRef.current.length; i++) {
      const note = notesRef.current[i];
      if (note.hit || note.missed || note.lane !== lane) continue;
      const delta = Math.abs(note.timeS - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
      if (note.timeS - now > hitWindow) break;
    }

    setHitFlash(lane);
    window.setTimeout(() => setHitFlash(null), 100);

    if (bestIndex >= 0 && bestDelta <= hitWindow) {
      notesRef.current[bestIndex].hit = true;

      const points = bestDelta <= 0.07 ? 300 : bestDelta <= 0.12 ? 200 : 100;
      setScore((s) => s + points);
      setCombo((c) => {
        const next = c + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      setLastJudgement(bestDelta <= 0.07 ? "Perfect" : bestDelta <= 0.12 ? "Great" : "Good");
    } else {
      setCombo(0);
      setLastJudgement("Miss");
    }

    setNotes(notesRef.current.map((n) => ({ ...n })));
    recalcAccuracy();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        hitLane("up");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        hitLane("down");
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function draw() {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const now = audio.currentTime;
    const approachS = 2.25;
    const hitX = Math.min(150, w * 0.22);
    const spawnX = w + 40;
    const topY = h * 0.34;
    const bottomY = h * 0.68;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#121a2f");
    bg.addColorStop(1, "#080d18");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const x = (w / 6) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    function laneLine(y: number, label: string, active: boolean) {
      ctx.strokeStyle = active ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = active ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(w - 30, y);
      ctx.stroke();

      ctx.fillStyle = active ? "rgba(45,212,191,0.24)" : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.arc(hitX, y, 34, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = active ? "#2dd4bf" : "rgba(255,255,255,0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hitX, y, 34, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, hitX, y + 5);
    }

    laneLine(topY, "↑", hitFlash === "up");
    laneLine(bottomY, "↓", hitFlash === "down");

    for (const note of notesRef.current) {
      if (note.hit) continue;
      const dt = note.timeS - now;
      if (dt < -0.35) continue;
      if (dt > approachS + 0.35) continue;

      const progress = 1 - clamp(dt / approachS, 0, 1);
      const x = spawnX + (hitX - spawnX) * progress;
      const y = note.lane === "up" ? topY : bottomY;
      const radius = note.missed ? 13 : 19;

      ctx.fillStyle = note.lane === "up" ? "#a78bfa" : "#2dd4bf";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.beginPath();
      ctx.arc(x - 6, y - 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.fillText(`${beatmap.title} — ${beatmap.version}`, 22, 26);

    ctx.textAlign = "right";
    ctx.fillText(lastJudgement, w - 22, 26);

    // miss notes that passed the hit line
    let changed = false;
    for (const note of notesRef.current) {
      if (!note.hit && !note.missed && now - note.timeS > 0.2) {
        note.missed = true;
        changed = true;
        setCombo(0);
        setLastJudgement("Miss");
      }
    }
    if (changed) {
      setNotes(notesRef.current.map((n) => ({ ...n })));
      recalcAccuracy();
    }
  }

  useEffect(() => {
    const tick = () => {
      draw();
      const audio = audioRef.current;
      setPlaying(Boolean(audio && !audio.paused));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  });

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      if (audio.currentTime < Math.max(0, beatmap.firstHitMs / 1000 - 3)) {
        audio.currentTime = Math.max(0, beatmap.firstHitMs / 1000 - 2);
      }
      audio.play().catch(() => undefined);
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  if (!audioFile || !audioUrl) {
    return <div className="emptyBox">Playable preview needs the song audio. Continue from difficulty selection so the app can load it from the .osz.</div>;
  }

  return (
    <div className="playableCard">
      <div className="playableHeader">
        <div>
          <h3>Playable conversion test</h3>
          <p>Use ↑ and ↓, or the buttons below. This preview helps you choose between auto, hitsound, xy, and alternate.</p>
        </div>
        <div className="playableStats">
          <span>Score <strong>{score}</strong></span>
          <span>Combo <strong>{combo}</strong></span>
          <span>Max <strong>{maxCombo}</strong></span>
          <span>Acc <strong>{accuracy}%</strong></span>
        </div>
      </div>

      <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={() => setPlaying(false)} />

      <canvas ref={canvasRef} className="playCanvas" />

      <div className="playControls">
        <button className="primary" type="button" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={() => resetGame(true)}>Restart near first hit</button>
        <button type="button" onClick={() => resetGame(false)}>Restart from 0:00</button>
      </div>

      <div className="physicalButtons">
        <button type="button" className={hitFlash === "up" ? "hitButton active" : "hitButton"} onPointerDown={() => hitLane("up")}>
          <span>↑</span>
          <small>UP LANE</small>
        </button>
        <button type="button" className={hitFlash === "down" ? "hitButton active" : "hitButton"} onPointerDown={() => hitLane("down")}>
          <span>↓</span>
          <small>DOWN LANE</small>
        </button>
      </div>
    </div>
  );
}
