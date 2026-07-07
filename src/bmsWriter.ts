import type { BmsStats, ConversionSettings, HitObject, OsuBeatmap, SelectedDifficulty, TimingPoint } from "./types";

const BMS_RESOLUTION = 192;

const CHANNEL_AIR = "13";
const CHANNEL_GND = "14";
const CHANNEL_AIR_HOLD = "53";
const CHANNEL_GND_HOLD = "54";
const CHANNEL_BOSS = "15";
const CHANNEL_MUSIC = "01";
const CHANNEL_BPM_LOOKUP = "08";

const MD_SMALL = "01";
const MD_LARGE1 = "0A";
const MD_GEMINI = "0E";
const MD_HOLD = "0F";
const MD_MASHER = "0G";
const MD_MUSIC = "10";
const MD_BOSS_ENTRANCE = "1A";
const MD_BOSS_EXIT = "1B";

const WAV_TABLE: Record<string, string> = {
  "01": "Small",
  "02": "Small (Up)",
  "03": "Small (Down)",
  "04": "Medium 1",
  "05": "Medium 1 (Up)",
  "06": "Medium 1 (Down)",
  "07": "Medium 2",
  "08": "Medium 2 (Up)",
  "09": "Medium 2 (Down)",
  "0A": "Large 1",
  "0B": "Large 2",
  "0C": "Raider",
  "0D": "Hammer",
  "0E": "Gemini",
  "0F": "Hold",
  "0G": "Masher",
  "0H": "Gear",
  "0I": "Raider (Upside-down)",
  "0J": "Hammer (Upside-down)",
  "0O": "Speed 1 (Both)",
  "0P": "Speed 2 (Both)",
  "0Q": "Speed 3 (Both)",
  "0R": "Speed 1 (Low)",
  "0S": "Speed 2 (Low)",
  "0T": "Speed 3 (Low)",
  "0U": "Speed 1 (High)",
  "0V": "Speed 2 (High)",
  "0W": "Speed 3 (High)",
  "10": "music.ogg",
  "11": "Boss Melee 1",
  "12": "Boss Melee 2",
  "13": "Boss Projectile 1",
  "14": "Boss Projectile 2",
  "15": "Boss Projectile 3",
  "16": "Boss Masher 1",
  "17": "Boss Masher 2",
  "18": "Boss Gear",
  "1A": "Boss Entrance",
  "1B": "Boss Exit",
  "1C": "Boss Ready Phase 1",
  "1D": "Boss End Phase 1",
  "1E": "Boss Ready Phase 2",
  "1F": "Boss End Phase 2",
  "23": "Note Pickup"
};

class TimeMapper {
  points: TimingPoint[];
  tickAtPoint: number[];

  constructor(timingPoints: TimingPoint[]) {
    const base = timingPoints
      .filter((tp) => tp.uninherited && tp.beatLengthMs > 0)
      .sort((a, b) => a.timeMs - b.timeMs);
    if (!base.length) base.push({ timeMs: 0, beatLengthMs: 500, meter: 4, uninherited: true, effects: 0, bpm: 120 });
    if (base[0].timeMs > 0) {
      const first = base[0];
      base.unshift({ ...first, timeMs: 0 });
    }
    this.points = base;
    this.tickAtPoint = [];
    let currentTick = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (i === 0) {
        this.tickAtPoint.push(0);
      } else {
        const prev = this.points[i - 1];
        currentTick += this.sectionTicks(this.points[i].timeMs - prev.timeMs, prev);
        this.tickAtPoint.push(currentTick);
      }
    }
  }

  sectionTicks(elapsedMs: number, tp: TimingPoint): number {
    const meter = tp.meter > 0 ? tp.meter : 4;
    const measureLenMs = tp.beatLengthMs * meter;
    if (measureLenMs <= 0) return 0;
    return elapsedMs / measureLenMs;
  }

  pointIndex(timeMs: number): number {
    let idx = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (this.points[i].timeMs <= timeMs) idx = i;
      else break;
    }
    return idx;
  }

  pointAtMs(timeMs: number): TimingPoint {
    return this.points[this.pointIndex(timeMs)];
  }

  msToTick(timeMs: number): number {
    const idx = this.pointIndex(timeMs);
    const tp = this.points[idx];
    return this.tickAtPoint[idx] + this.sectionTicks(timeMs - tp.timeMs, tp);
  }
}

class BmsChart {
  cells = new Map<string, string[]>();
  bpmEvents: Array<{ tick: number; bpm: number }> = [];

  key(measure: number, channel: string) {
    return `${measure}|${channel}`;
  }

  add(tick: number, channel: string, code: string, allowShift = true) {
    if (tick < 0) return;
    let measure = Math.floor(tick + 1e-9);
    const frac = tick - measure;
    let idx = Math.round(frac * BMS_RESOLUTION);
    if (idx >= BMS_RESOLUTION) {
      measure += 1;
      idx = 0;
    }
    if (measure < 0) return;
    const key = this.key(measure, channel);
    const row = this.cells.get(key) ?? Array(BMS_RESOLUTION).fill("00");
    if (row[idx] !== "00" && row[idx] !== code && allowShift) {
      for (const delta of [1, -1, 2, -2, 3, -3]) {
        const j = idx + delta;
        if (j >= 0 && j < BMS_RESOLUTION && row[j] === "00") {
          idx = j;
          break;
        }
      }
    }
    row[idx] = code;
    this.cells.set(key, row);
  }

  addHold(startTick: number, endTick: number, channel: string, code = MD_HOLD) {
    if (endTick <= startTick) return;
    this.add(startTick, channel, code, false);
    this.add(endTick, channel, code, false);
  }

  addBpmChange(tick: number, bpm: number) {
    if (bpm > 0) this.bpmEvents.push({ tick, bpm });
  }

  renderLines(baseBpm: number): string[] {
    this.add(0, CHANNEL_MUSIC, MD_MUSIC, false);

    const lookup = new Map<number, string>();
    const lookupLines: string[] = [];
    let nextCode = 1;

    for (const ev of this.bpmEvents) {
      if (Math.abs(ev.bpm - baseBpm) < 0.001) continue;
      const key = Math.round(ev.bpm * 1000000) / 1000000;
      if (!lookup.has(key)) {
        if (nextCode > 255) continue;
        const code = nextCode.toString(16).toUpperCase().padStart(2, "0");
        lookup.set(key, code);
        lookupLines.push(`#BPM${code} ${Number(ev.bpm.toFixed(6))}`);
        nextCode++;
      }
      this.add(ev.tick, CHANNEL_BPM_LOOKUP, lookup.get(key)!, false);
    }

    const dataLines: string[] = [];
    const entries = [...this.cells.entries()].map(([key, row]) => {
      const [measure, channel] = key.split("|");
      return { measure: Number(measure), channel, row };
    });
    entries.sort((a, b) => a.measure - b.measure || a.channel.localeCompare(b.channel));

    for (const item of entries) {
      if (item.row.every((x) => x === "00")) continue;
      dataLines.push(`#${String(item.measure).padStart(3, "0")}${item.channel}:${item.row.join("")}`);
    }

    return lookupLines.length ? [...lookupLines, "", ...dataLines] : dataLines;
  }
}

function currentInheritedAt(points: TimingPoint[], timeMs: number): TimingPoint | null {
  let out: TimingPoint | null = null;
  for (const tp of points) {
    if (tp.timeMs <= timeMs) out = tp;
    else break;
  }
  return out;
}

function sliderDurationMs(beatmap: OsuBeatmap, obj: HitObject, mapper: TimeMapper): number {
  if (obj.params.length < 3) return 0;
  const slides = Number.parseInt(obj.params[1]);
  const pixelLength = Number.parseFloat(obj.params[2]);
  if (!Number.isFinite(slides) || !Number.isFinite(pixelLength)) return 0;

  const sliderMultiplier = Number.parseFloat(beatmap.difficulty.SliderMultiplier ?? "1.4") || 1.4;
  const beatLen = mapper.pointAtMs(obj.timeMs).beatLengthMs;
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

function hasMeaningfulTaikoColours(objects: HitObject[]): boolean {
  const circles = objects.filter((o) => o.isCircle);
  if (!circles.length) return false;
  const kats = circles.filter((o) => o.taikoColor === "kat").length;
  const ratio = kats / circles.length;
  return ratio >= 0.05 && ratio <= 0.95;
}

function laneForObject(
  obj: HitObject,
  beatmap: OsuBeatmap,
  policy: ConversionSettings["lanePolicy"],
  noteIndex: number,
  useTaikoColours: boolean
): "air" | "ground" {
  if (beatmap.mode === 1) return obj.taikoColor === "kat" ? "air" : "ground";

  if (policy === "hitsound") return obj.taikoColor === "kat" ? "air" : "ground";
  if (policy === "xy") return obj.y < 192 ? "air" : "ground";
  if (policy === "alternate") return noteIndex % 2 ? "air" : "ground";

  if (useTaikoColours) return obj.taikoColor === "kat" ? "air" : "ground";
  return obj.y < 192 ? "air" : "ground";
}

function channelForLane(lane: "air" | "ground", hold = false): string {
  if (lane === "air") return hold ? CHANNEL_AIR_HOLD : CHANNEL_AIR;
  return hold ? CHANNEL_GND_HOLD : CHANNEL_GND;
}

function convertToBmsChart(beatmap: OsuBeatmap, settings: ConversionSettings): { chart: BmsChart; stats: BmsStats } {
  const mapper = new TimeMapper(beatmap.timingPoints);
  const chart = new BmsChart();
  const stats: BmsStats = {
    circles: 0,
    sliders: 0,
    spinners: 0,
    holds: 0,
    air: 0,
    ground: 0,
    geminis: 0,
    bpmChanges: 0
  };

  const baseBpm = beatmap.baseBpm;
  for (const tp of beatmap.timingPoints.slice(1)) {
    if (tp.uninherited && tp.bpm > 0 && Math.abs(tp.bpm - baseBpm) > 0.001) {
      chart.addBpmChange(mapper.msToTick(Math.max(0, tp.timeMs)), tp.bpm);
      stats.bpmChanges++;
    }
  }

  if (settings.addBossEvents) {
    chart.add(Math.max(0, mapper.msToTick(Math.max(0, beatmap.firstHitMs - 2500))), CHANNEL_BOSS, MD_BOSS_ENTRANCE);
    chart.add(mapper.msToTick(beatmap.lastHitMs + 2000), CHANNEL_BOSS, MD_BOSS_EXIT);
  }

  const useTaikoColours = hasMeaningfulTaikoColours(beatmap.hitObjects);
  const circleTimes = new Map<number, HitObject[]>();
  for (const obj of beatmap.hitObjects) {
    if (obj.isCircle) circleTimes.set(obj.timeMs, [...(circleTimes.get(obj.timeMs) ?? []), obj]);
  }

  let noteIndex = 0;
  for (const obj of beatmap.hitObjects) {
    const startTick = mapper.msToTick(obj.timeMs);

    if (obj.isCircle) {
      stats.circles++;
      const simultaneous = circleTimes.get(obj.timeMs) ?? [];
      const lane = laneForObject(obj, beatmap, settings.lanePolicy, noteIndex, useTaikoColours);
      noteIndex++;

      if (simultaneous.length >= 2 && simultaneous[0] === obj) {
        chart.add(startTick, CHANNEL_AIR, MD_GEMINI, false);
        chart.add(startTick, CHANNEL_GND, MD_GEMINI, false);
        stats.geminis++;
        continue;
      }
      chart.add(startTick, channelForLane(lane, false), obj.hasFinish ? MD_LARGE1 : MD_SMALL);
      stats[lane]++;
      continue;
    }

    if (obj.isSlider) {
      stats.sliders++;
      const lane = laneForObject(obj, beatmap, settings.lanePolicy, noteIndex, useTaikoColours);
      noteIndex++;
      const dur = sliderDurationMs(beatmap, obj, mapper);
      if (dur >= settings.sliderHoldMs) {
        chart.addHold(startTick, mapper.msToTick(obj.timeMs + dur), channelForLane(lane, true), MD_HOLD);
        stats.holds++;
      } else {
        chart.add(startTick, channelForLane(lane, false), MD_SMALL);
      }
      stats[lane]++;
      continue;
    }

    if (obj.isSpinner) {
      stats.spinners++;
      chart.addHold(startTick, mapper.msToTick(spinnerEndMs(obj)), CHANNEL_GND_HOLD, MD_MASHER);
      stats.holds++;
      stats.ground++;
    }
  }

  return { chart, stats };
}

export function makeBmsText(selected: SelectedDifficulty, settings: ConversionSettings): { text: string; stats: BmsStats } {
  const { beatmap, mdLevel, designer } = selected;
  const { chart, stats } = convertToBmsChart(beatmap, settings);
  const lines: string[] = [
    "\uFEFF*---------------------- HEADER FIELD",
    "",
    `#PLAYER ${settings.playerSpeed}`,
    `#GENRE ${settings.scene}`,
    `#TITLE ${beatmap.title}`,
    `#ARTIST ${beatmap.artist}`,
    `#LEVELDESIGN ${designer}`,
    `#BPM ${Number(beatmap.baseBpm.toFixed(6))}`,
    `#PLAYLEVEL ${mdLevel}`,
    "#RANK 2",
    "",
    "",
    "#LNTYPE 1",
    ""
  ];

  for (const [code, name] of Object.entries(WAV_TABLE)) lines.push(`#WAV${code} ${name}`);
  lines.push("", "", "*---------------------- MAIN DATA FIELD", "");
  lines.push(...chart.renderLines(beatmap.baseBpm));
  lines.push("");
  return { text: lines.join("\n"), stats };
}

export function makeInfoJson(selected: SelectedDifficulty[], settings: ConversionSettings): string {
  const main = selected[0].beatmap;
  const designer = selected[0]?.designer || "osu2MD web";
  const info: Record<string, any> = {
    name: main.title,
    author: main.artist,
    bpm: `${Number(main.baseBpm.toFixed(6))}`,
    scene: settings.scene,
    levelDesigner: designer,
    levelDesigner1: selected.find((s) => s.mdSlot === 1)?.designer ?? designer,
    levelDesigner2: selected.find((s) => s.mdSlot === 2)?.designer ?? designer,
    levelDesigner3: selected.find((s) => s.mdSlot === 3)?.designer ?? designer,
    levelDesigner4: designer,
    difficulty1: "0",
    difficulty2: "0",
    difficulty3: "0",
    difficulty4: "0",
    hideBmsMode: "CLICK",
    hideBmsDifficulty: "0",
    hideBmsMessage: "Converted from osu!/osu!taiko with osu2MuseDash Web.",
    unlockLevel: "0",
    searchTags: ["osu", "converted", "osu2musedash-web"]
  };

  for (const item of selected) {
    info[`difficulty${item.mdSlot}`] = String(item.mdLevel);
  }

  return JSON.stringify(info, null, "\t");
}
