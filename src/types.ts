export type OsuMode = 0 | 1;

export interface TimingPoint {
  timeMs: number;
  beatLengthMs: number;
  meter: number;
  uninherited: boolean;
  effects: number;
  bpm: number;
}

export interface HitObject {
  x: number;
  y: number;
  timeMs: number;
  typeFlags: number;
  hitSound: number;
  params: string[];
  raw: string;
  isCircle: boolean;
  isSlider: boolean;
  isSpinner: boolean;
  hasWhistle: boolean;
  hasFinish: boolean;
  hasClap: boolean;
  taikoColor: "don" | "kat";
}

export interface OsuBeatmap {
  id: string;
  sourcePath: string;
  text: string;
  sections: Record<string, string[]>;
  general: Record<string, string>;
  metadata: Record<string, string>;
  difficulty: Record<string, string>;
  timingPoints: TimingPoint[];
  inheritedPoints: TimingPoint[];
  hitObjects: HitObject[];
  backgroundPath: string | null;
  audioFilename: string | null;
  mode: OsuMode;
  title: string;
  artist: string;
  creator: string;
  version: string;
  previewTimeMs: number;
  firstHitMs: number;
  lastHitMs: number;
  baseBpm: number;
  estimatedMdLevel: number;
}

export interface LoadedBeatmapPackage {
  kind: "osz" | "osu";
  name: string;
  zip?: any;
  files: Map<string, Uint8Array>;
  beatmaps: OsuBeatmap[];
  defaultAudioPath: string | null;
  defaultBackgroundPath: string | null;
}

export type LanePolicy = "auto" | "hitsound" | "xy" | "alternate";

export interface ConversionSettings {
  scene: string;
  playerSpeed: number;
  lanePolicy: LanePolicy;
  sliderHoldMs: number;
  addBossEvents: boolean;
}

export interface SelectedDifficulty {
  beatmap: OsuBeatmap;
  mdSlot: 1 | 2 | 3;
  mdLevel: number;
  designer: string;
}

export interface DemoSelection {
  startS: number;
  durationS: number;
}

export interface BmsStats {
  circles: number;
  sliders: number;
  spinners: number;
  holds: number;
  air: number;
  ground: number;
  geminis: number;
  bpmChanges: number;
}
