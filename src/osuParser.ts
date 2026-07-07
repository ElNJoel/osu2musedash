import JSZip from "jszip";
import type { HitObject, LoadedBeatmapPackage, OsuBeatmap, OsuMode, TimingPoint } from "./types";

function safeTextDecode(raw: Uint8Array): string {
  const encodings = ["utf-8", "windows-1252"];
  for (const enc of encodings) {
    try {
      return new TextDecoder(enc, { fatal: false }).decode(raw);
    } catch {
      // keep trying
    }
  }
  return new TextDecoder().decode(raw);
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

function parseKeyValue(lines: string[], sep = ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(sep);
    if (idx >= 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function parseSections(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const rawLine of stripBom(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const m = line.match(/^\[(.+)]$/);
    if (m) {
      current = m[1];
      sections[current] = sections[current] ?? [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

function numericRecordValue(data: Record<string, string>, key: string, fallback: number): number {
  const v = Number.parseFloat(data[key] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function makeId(path: string, text: string): string {
  let hash = 0;
  const value = path + "::" + text.slice(0, 4096);
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `${path}-${Math.abs(hash)}`;
}

function makeHitObject(line: string): HitObject | null {
  const parts = line.split(",");
  if (parts.length < 5) return null;
  const x = Number.parseInt(parts[0]);
  const y = Number.parseInt(parts[1]);
  const timeMs = Number.parseInt(parts[2]);
  const typeFlags = Number.parseInt(parts[3]);
  const hitSound = Number.parseInt(parts[4]);
  if (![x, y, timeMs, typeFlags, hitSound].every(Number.isFinite)) return null;

  const hasWhistle = (hitSound & 2) !== 0;
  const hasFinish = (hitSound & 4) !== 0;
  const hasClap = (hitSound & 8) !== 0;

  return {
    x,
    y,
    timeMs,
    typeFlags,
    hitSound,
    params: parts.slice(5),
    raw: line,
    isCircle: (typeFlags & 1) !== 0,
    isSlider: (typeFlags & 2) !== 0,
    isSpinner: (typeFlags & 8) !== 0,
    hasWhistle,
    hasFinish,
    hasClap,
    taikoColor: hasWhistle || hasClap ? "kat" : "don"
  };
}

function parseBackground(events: string[]): string | null {
  for (const line of events) {
    const m = line.match(/^(?:0|Background),\s*\d+\s*,\s*"([^"]+)"/i);
    if (m) return m[1].replaceAll("\\", "/");
  }
  return null;
}

function estimateMdLevel(beatmap: Pick<OsuBeatmap, "difficulty" | "hitObjects" | "firstHitMs" | "lastHitMs">): number {
  const od = numericRecordValue(beatmap.difficulty, "OverallDifficulty", 5);
  const ar = numericRecordValue(beatmap.difficulty, "ApproachRate", od);
  const cs = numericRecordValue(beatmap.difficulty, "CircleSize", 4);
  const durationMin = Math.max(0.25, (beatmap.lastHitMs - beatmap.firstHitMs) / 60000);
  const density = beatmap.hitObjects.length / durationMin;
  const raw = od * 0.55 + ar * 0.25 + cs * 0.08 + Math.min(3.0, density / 115);
  return Math.max(1, Math.min(10, Math.round(raw)));
}

export function parseOsuText(path: string, raw: Uint8Array): OsuBeatmap | null {
  const text = safeTextDecode(raw);
  const sections = parseSections(text);
  const general = parseKeyValue(sections.General ?? []);
  const metadata = parseKeyValue(sections.Metadata ?? []);
  const difficulty = parseKeyValue(sections.Difficulty ?? []);

  const modeRaw = Number.parseInt(general.Mode ?? "0");
  if (modeRaw !== 0 && modeRaw !== 1) return null;

  const timingPoints: TimingPoint[] = [];
  const inheritedPoints: TimingPoint[] = [];

  for (const line of sections.TimingPoints ?? []) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;
    const timeMs = Number.parseFloat(parts[0]);
    const beatLengthMs = Number.parseFloat(parts[1]);
    const meter = Number.parseInt(parts[2] || "4");
    const uninherited = parts.length > 6 ? Number.parseInt(parts[6] || "1") === 1 : true;
    const effects = parts.length > 7 ? Number.parseInt(parts[7] || "0") : 0;
    if (!Number.isFinite(timeMs) || !Number.isFinite(beatLengthMs)) continue;
    const tp: TimingPoint = {
      timeMs,
      beatLengthMs,
      meter: Number.isFinite(meter) && meter > 0 ? meter : 4,
      uninherited,
      effects: Number.isFinite(effects) ? effects : 0,
      bpm: beatLengthMs > 0 ? 60000 / beatLengthMs : 0
    };
    if (uninherited && beatLengthMs > 0) timingPoints.push(tp);
    else inheritedPoints.push(tp);
  }
  timingPoints.sort((a, b) => a.timeMs - b.timeMs);
  inheritedPoints.sort((a, b) => a.timeMs - b.timeMs);

  const hitObjects = (sections.HitObjects ?? [])
    .map(makeHitObject)
    .filter((x): x is HitObject => Boolean(x))
    .sort((a, b) => a.timeMs - b.timeMs);

  const firstHitMs = hitObjects[0]?.timeMs ?? 0;
  const lastHitMs = hitObjects[hitObjects.length - 1]?.timeMs ?? 0;
  const baseBpm = timingPoints.find((tp) => tp.uninherited && tp.beatLengthMs > 0)?.bpm ?? 120;
  const previewTimeMs = Number.parseInt(general.PreviewTime ?? "-1");

  const tmp = {
    id: makeId(path, text),
    sourcePath: path,
    text,
    sections,
    general,
    metadata,
    difficulty,
    timingPoints,
    inheritedPoints,
    hitObjects,
    backgroundPath: parseBackground(sections.Events ?? []),
    audioFilename: general.AudioFilename?.replaceAll("\\", "/") ?? null,
    mode: modeRaw as OsuMode,
    title: metadata.TitleUnicode || metadata.Title || path.replace(/\.osu$/i, ""),
    artist: metadata.ArtistUnicode || metadata.Artist || "Unknown artist",
    creator: metadata.Creator || "osu mapper",
    version: metadata.Version || path.replace(/\.osu$/i, ""),
    previewTimeMs: Number.isFinite(previewTimeMs) ? previewTimeMs : -1,
    firstHitMs,
    lastHitMs,
    baseBpm,
    estimatedMdLevel: 1
  } satisfies OsuBeatmap;

  tmp.estimatedMdLevel = estimateMdLevel(tmp);
  return tmp;
}

function normalizeZipPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function findFileByBasename(files: Map<string, Uint8Array>, wanted: string | null): string | null {
  if (!wanted) return null;
  const normalized = normalizeZipPath(wanted);
  if (files.has(normalized)) return normalized;
  const base = normalized.split("/").pop()?.toLowerCase();
  if (!base) return null;
  for (const key of files.keys()) {
    if (key.split("/").pop()?.toLowerCase() === base) return key;
  }
  return null;
}

export async function loadBeatmapPackage(file: File): Promise<LoadedBeatmapPackage> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".osu")) {
    const raw = new Uint8Array(await file.arrayBuffer());
    const beatmap = parseOsuText(file.name, raw);
    if (!beatmap) throw new Error("This .osu is not osu!standard or osu!taiko, or it could not be parsed.");
    return {
      kind: "osu",
      name: file.name,
      files: new Map([[file.name, raw]]),
      beatmaps: [beatmap],
      defaultAudioPath: null,
      defaultBackgroundPath: null
    };
  }

  if (!lower.endsWith(".osz")) {
    throw new Error("Please choose an .osz or .osu file.");
  }

  const zip = await JSZip.loadAsync(file);
  const files = new Map<string, Uint8Array>();
  const beatmaps: OsuBeatmap[] = [];

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    const path = normalizeZipPath(entry.name);
    const bytes = new Uint8Array(await entry.async("uint8array"));
    files.set(path, bytes);
    if (path.toLowerCase().endsWith(".osu")) {
      const parsed = parseOsuText(path, bytes);
      if (parsed) beatmaps.push(parsed);
    }
  }

  beatmaps.sort((a, b) => {
    if (a.estimatedMdLevel !== b.estimatedMdLevel) return a.estimatedMdLevel - b.estimatedMdLevel;
    return a.hitObjects.length - b.hitObjects.length;
  });

  if (!beatmaps.length) throw new Error("No supported osu!standard/osu!taiko .osu files were found inside this .osz.");

  const first = beatmaps[0];
  return {
    kind: "osz",
    name: file.name,
    zip,
    files,
    beatmaps,
    defaultAudioPath: findFileByBasename(files, first.audioFilename),
    defaultBackgroundPath: findFileByBasename(files, first.backgroundPath)
  };
}

export function resolvePackageFile(pkg: LoadedBeatmapPackage, path: string | null): Uint8Array | null {
  if (!path) return null;
  const direct = pkg.files.get(path);
  if (direct) return direct;
  const found = findFileByBasename(pkg.files, path);
  return found ? pkg.files.get(found) ?? null : null;
}

export function findBestAudioPath(pkg: LoadedBeatmapPackage, beatmap: OsuBeatmap): string | null {
  return findFileByBasename(pkg.files, beatmap.audioFilename) ?? pkg.defaultAudioPath;
}

export function findBestBackgroundPath(pkg: LoadedBeatmapPackage, beatmap: OsuBeatmap): string | null {
  return findFileByBasename(pkg.files, beatmap.backgroundPath) ?? pkg.defaultBackgroundPath;
}

export function bytesToFile(bytes: Uint8Array, filename: string, type = "application/octet-stream"): File {
  return new File([bytes], filename, { type });
}
