import { useEffect, useMemo, useRef, useState } from "react";
import type { HitObject, LanePolicy, OsuBeatmap, TimingPoint } from "./types";

interface Props {
  beatmap: OsuBeatmap;
  audioFile: File | null;
  lanePolicy: LanePolicy;
  sliderHoldMs?: number;
}

type Lane = "up" | "down";
type NoteKind = "tap" | "hold";

interface PlayNote {
  id: number;
  kind: NoteKind;
  timeS: number;
  endS: number;
  lane: Lane;
  hit: boolean;
  missed: boolean;
  holding: boolean;
  started: boolean;
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

function currentInheritedAt(points: TimingPoint[], timeMs: number): TimingPoint | null {
  let best: TimingPoint | null = null;
  for (const point of points) {
    if (point.timeMs <= timeMs) best = point;
    else break;
  }
  return best;
}

function timingPointAt(beatmap: OsuBeatmap, timeMs: number): TimingPoint {
  let best = beatmap.timingPoints.find((tp) => tp.uninherited && tp.beatLengthMs > 0) ?? {
    timeMs: 0,
    beatLengthMs: 500,
    meter: 4,
    uninherited: true,
    effects: 0,
    bpm: 120
  };

  for (const point of beatmap.timingPoints) {
    if (point.uninherited && point.beatLengthMs > 0 && point.timeMs <= timeMs) best = point;
    if (point.timeMs > timeMs) break;
  }

  return best;
}

function sliderDurationMs(beatmap: OsuBeatmap, obj: HitObject): number {
  if (obj.params.length < 3) return 0;

  const slides = Number.parseInt(obj.params[1]);
  const pixelLength = Number.parseFloat(obj.params[2]);
  if (!Number.isFinite(slides) || !Number.isFinite(pixelLength)) return 0;

  const sliderMultiplier = Number.parseFloat(beatmap.difficulty.SliderMultiplier ?? "1.4") || 1.4;
  const beatLen = timingPointAt(beatmap, obj.timeMs).beatLengthMs;
  const inherited = currentInheritedAt(beatmap.inheritedPoints, obj.timeMs);

  let svMultiplier = 1.0;
  if (inherited && inherited.beatLengthMs < 0) {
    svMultiplier = Math.max(0.1, Math.min(10, -100.0 / inherited.beatLengthMs));
  }

  const duration = (beatLen * slides * pixelLength) / Math.max(1e-6, sliderMultiplier * 100.0 * svMultiplier);
  return Math.max(1, Math.round(duration));
}

function spinnerEndMs(obj: HitObject): number {
  const end = Number.parseInt(obj.params[0] ?? "");
  return Number.isFinite(end) ? end : obj.timeMs + 1000;
}

function buildPreviewNotes(beatmap: OsuBeatmap, lanePolicy: LanePolicy, sliderHoldMs = 240): PlayNote[] {
  let noteIndex = 0;

  return beatmap.hitObjects
    .filter((obj) => obj.isCircle || obj.isSlider || obj.isSpinner)
    .map((obj, index) => {
      const lane = laneForObject(obj, noteIndex++, lanePolicy);
      let kind: NoteKind = "tap";
      let endMs = obj.timeMs;

      if (obj.isSlider) {
        const duration = sliderDurationMs(beatmap, obj);
        if (duration >= sliderHoldMs) {
          kind = "hold";
          endMs = obj.timeMs + duration;
        }
      }

      if (obj.isSpinner) {
        kind = "hold";
        endMs = spinnerEndMs(obj);
      }

      return {
        id: index,
        kind,
        timeS: obj.timeMs / 1000,
        endS: Math.max(obj.timeMs + 150, endMs) / 1000,
        lane,
        hit: false,
        missed: false,
        holding: false,
        started: false
      };
    });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function policyLabel(policy: LanePolicy): string {
  if (policy === "auto") return "AUTO · smart mapping";
  if (policy === "hitsound") return "HITSOUND · Don/Kat mapping";
  if (policy === "xy") return "XY · vertical position";
  return "ALTERNATE · up/down pattern";
}

function policyHelp(policy: LanePolicy): string {
  if (policy === "auto") return "Uses taiko/hitsound clues first, then object position.";
  if (policy === "hitsound") return "Whistle/Clap/Kat go up, Don-style hits go down.";
  if (policy === "xy") return "Notes near the top of the osu! chart go up, lower notes go down.";
  return "Notes alternate up/down regardless of original position.";
}

export function PlayablePreview({ beatmap, audioFile, lanePolicy, sliderHoldMs = 240 }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const notesRef = useRef<PlayNote[]>([]);
  const heldRef = useRef<Set<Lane>>(new Set());

  const [notes, setNotes] = useState<PlayNote[]>([]);
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [hitFlash, setHitFlash] = useState<Lane | null>(null);
  const [lastJudgement, setLastJudgement] = useState("Ready");
  const [holdCount, setHoldCount] = useState(0);

  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : null), [audioFile]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function resetNoteState(label = "Ready") {
    const fresh = buildPreviewNotes(beatmap, lanePolicy, sliderHoldMs);
    notesRef.current = fresh.map((n) => ({ ...n }));
    setNotes(fresh);
    setHoldCount(fresh.filter((n) => n.kind === "hold").length);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setAccuracy(100);
    setLastJudgement(label);
    heldRef.current.clear();
  }

  useEffect(() => {
    resetNoteState("Mode changed");
    setPlaying(false);

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = Math.max(0, beatmap.firstHitMs / 1000 - 2);
    }
  }, [beatmap.id, lanePolicy, sliderHoldMs]);

  function resetGame(startAtFirstHit = true) {
    resetNoteState("Ready");
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

  function addCombo(points: number, judgement: string) {
    setScore((s) => s + points);
    setCombo((c) => {
      const next = c + 1;
      setMaxCombo((m) => Math.max(m, next));
      return next;
    });
    setLastJudgement(judgement);
  }

  function missCombo(judgement = "Miss") {
    setCombo(0);
    setLastJudgement(judgement);
  }

  function hitLane(lane: Lane) {
    const audio = audioRef.current;
    if (!audio || !playing) return;

    heldRef.current.add(lane);
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
      const note = notesRef.current[bestIndex];

      if (note.kind === "hold") {
        note.started = true;
        note.holding = true;
        const points = bestDelta <= 0.07 ? 150 : bestDelta <= 0.12 ? 100 : 60;
        addCombo(points, bestDelta <= 0.07 ? "Hold Start" : "Hold");
      } else {
        note.hit = true;
        const points = bestDelta <= 0.07 ? 300 : bestDelta <= 0.12 ? 200 : 100;
        addCombo(points, bestDelta <= 0.07 ? "Perfect" : bestDelta <= 0.12 ? "Great" : "Good");
      }
    } else {
      missCombo("Miss");
    }

    setNotes(notesRef.current.map((n) => ({ ...n })));
    recalcAccuracy();
  }

  function releaseLane(lane: Lane) {
    heldRef.current.delete(lane);

    const audio = audioRef.current;
    if (!audio) return;

    const now = audio.currentTime;
    let changed = false;

    for (const note of notesRef.current) {
      if (note.kind !== "hold" || note.lane !== lane || note.hit || note.missed || !note.started) continue;
      if (now < note.endS - 0.12) {
        note.missed = true;
        note.holding = false;
        changed = true;
        missCombo("Released early");
      }
    }

    if (changed) {
      setNotes(notesRef.current.map((n) => ({ ...n })));
      recalcAccuracy();
    }
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

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        releaseLane("up");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        releaseLane("down");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  function noteX(noteTimeS: number, now: number, hitX: number, spawnX: number, approachS: number) {
    const dt = noteTimeS - now;
    const progress = 1 - clamp(dt / approachS, 0, 1);
    return spawnX + (hitX - spawnX) * progress;
  }

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

    laneLine(topY, "↑", hitFlash === "up" || heldRef.current.has("up"));
    laneLine(bottomY, "↓", hitFlash === "down" || heldRef.current.has("down"));

    for (const note of notesRef.current) {
      if (note.hit) continue;

      const dt = note.timeS - now;
      if (note.kind === "tap") {
        if (dt < -0.35 || dt > approachS + 0.35) continue;

        const x = noteX(note.timeS, now, hitX, spawnX, approachS);
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
      } else {
        const startsVisible = note.timeS - now <= approachS + 0.35;
        const endsVisible = note.endS - now >= -0.35;
        if (!startsVisible || !endsVisible) continue;

        const y = note.lane === "up" ? topY : bottomY;
        const xStartRaw = noteX(note.timeS, now, hitX, spawnX, approachS);
        const xEndRaw = noteX(note.endS, now, hitX, spawnX, approachS);
        const xStart = note.started ? hitX : xStartRaw;
        const xEnd = Math.max(xStart + 12, xEndRaw);
        const barH = 22;

        ctx.fillStyle = note.started ? "rgba(45, 212, 191, 0.78)" : "rgba(251, 146, 60, 0.82)";
        ctx.beginPath();
        ctx.roundRect(Math.min(xStart, xEnd), y - barH / 2, Math.abs(xEnd - xStart), barH, 11);
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = note.lane === "up" ? "#a78bfa" : "#2dd4bf";
        ctx.beginPath();
        ctx.arc(xStart, y, 21, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = "#f97316";
        ctx.beginPath();
        ctx.arc(xEnd, y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "900 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("HOLD", clamp((xStart + xEnd) / 2, hitX + 44, w - 44), y + 4);
      }
    }

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.fillText(`${policyLabel(lanePolicy)} · ${beatmap.version}`, 22, 26);

    ctx.textAlign = "right";
    ctx.fillText(lastJudgement, w - 22, 26);

    let changed = false;

    updateRuntimeJudgements();
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

  function updateRuntimeJudgements() {
    const audio = audioRef.current;
    if (!audio) return;

    const now = audio.currentTime;
    let changed = false;

    for (const note of notesRef.current) {
      if (note.hit || note.missed) continue;

      if (note.kind === "tap" && now - note.timeS > 0.2) {
        note.missed = true;
        changed = true;
        missCombo("Miss");
      }

      if (note.kind === "hold") {
        if (!note.started && now - note.timeS > 0.2) {
          note.missed = true;
          changed = true;
          missCombo("Miss hold");
        }

        if (note.started && !note.hit && !note.missed) {
          if (!heldRef.current.has(note.lane) && now < note.endS - 0.12) {
            note.missed = true;
            note.holding = false;
            changed = true;
            missCombo("Released early");
          } else if (now >= note.endS - 0.06) {
            note.hit = true;
            note.holding = false;
            changed = true;
            setScore((s) => s + 450);
            setLastJudgement("Hold Complete");
          }
        }
      }
    }

    if (changed) {
      setNotes(notesRef.current.map((n) => ({ ...n })));
      recalcAccuracy();
    }
  }

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
          <div className="previewModeBadge">{policyLabel(lanePolicy)}</div>
          <h3>Playable conversion test</h3>
          <p>{policyHelp(lanePolicy)}</p>
          <p>Extended notes are shown as HOLD bars. Keep ↑ or ↓ pressed until the orange tail reaches the hit circle.</p>
        </div>
        <div className="playableStats">
          <span>Score <strong>{score}</strong></span>
          <span>Combo <strong>{combo}</strong></span>
          <span>Max <strong>{maxCombo}</strong></span>
          <span>Acc <strong>{accuracy}%</strong></span>
          <span>Holds <strong>{holdCount}</strong></span>
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
        <button
          type="button"
          className={hitFlash === "up" || heldRef.current.has("up") ? "hitButton active" : "hitButton"}
          onPointerDown={() => hitLane("up")}
          onPointerUp={() => releaseLane("up")}
          onPointerCancel={() => releaseLane("up")}
          onPointerLeave={() => releaseLane("up")}
        >
          <span>↑</span>
          <small>UP / HOLD</small>
        </button>
        <button
          type="button"
          className={hitFlash === "down" || heldRef.current.has("down") ? "hitButton active" : "hitButton"}
          onPointerDown={() => hitLane("down")}
          onPointerUp={() => releaseLane("down")}
          onPointerCancel={() => releaseLane("down")}
          onPointerLeave={() => releaseLane("down")}
        >
          <span>↓</span>
          <small>DOWN / HOLD</small>
        </button>
      </div>
    </div>
  );
}
