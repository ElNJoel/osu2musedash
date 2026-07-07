import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { DemoSelection } from "./types";

let ffmpegPromise: Promise<FFmpeg> | null = null;

export function secondsLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${min}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  return `${cleanBase}${path.replace(/^\//, "")}`;
}

async function getFfmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      if (onLog) onLog(message);
    });

    ffmpeg.on("progress", ({ progress, time }) => {
      if (onLog && Number.isFinite(progress)) {
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        if (pct % 10 === 0) onLog(`ffmpeg progress ${pct}% · ${Math.round(time / 1000000)}s`);
      }
    });

    const coreURL = assetUrl("ffmpeg/ffmpeg-core.js");
    const wasmURL = assetUrl("ffmpeg/ffmpeg-core.wasm");
    onLog?.("Loading local ffmpeg.wasm core...");
    try {
      await ffmpeg.load({ coreURL, wasmURL });
    } catch (err) {
      await ffmpeg.terminate().catch(() => undefined);
      ffmpegPromise = null;
      const details = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not load local ffmpeg.wasm core. Make sure /public/ffmpeg/ffmpeg-core.js and ffmpeg-core.wasm exist after npm install/build. Details: ${details}`
      );
    }

    return ffmpeg;
  })();

  return ffmpegPromise;
}

function extensionFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? `.${ext}` : ".mp3";
}

export async function convertAudioToOggs(
  audioFile: File,
  demo: DemoSelection,
  onProgress?: (msg: string) => void
): Promise<{ musicOgg: Uint8Array; demoOgg: Uint8Array }> {
  const ffmpeg = await getFfmpeg(onProgress);
  const input = `input${extensionFromName(audioFile.name)}`;

  onProgress?.("Loading audio into ffmpeg.wasm...");
  await ffmpeg.writeFile(input, await fetchFile(audioFile));

  onProgress?.("Encoding full music.ogg...");
  await ffmpeg.exec(["-i", input, "-map", "0:a:0", "-vn", "-c:a", "libvorbis", "-q:a", "5", "music.ogg"]);

  onProgress?.("Encoding demo.ogg...");
  const fadeOutStart = Math.max(0.1, demo.durationS - 0.35).toFixed(3);
  await ffmpeg.exec([
    "-ss",
    demo.startS.toFixed(3),
    "-t",
    demo.durationS.toFixed(3),
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-af",
    `afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutStart}:d=0.35`,
    "-c:a",
    "libvorbis",
    "-q:a",
    "4",
    "demo.ogg"
  ]);

  const music = await ffmpeg.readFile("music.ogg");
  const demoData = await ffmpeg.readFile("demo.ogg");

  await ffmpeg.deleteFile(input).catch(() => undefined);
  await ffmpeg.deleteFile("music.ogg").catch(() => undefined);
  await ffmpeg.deleteFile("demo.ogg").catch(() => undefined);

  return {
    musicOgg: music instanceof Uint8Array ? music : new Uint8Array(music as ArrayBuffer),
    demoOgg: demoData instanceof Uint8Array ? demoData : new Uint8Array(demoData as ArrayBuffer)
  };
}

export async function estimateAudioDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Could not read audio metadata."));
    });
    return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 180;
  } finally {
    URL.revokeObjectURL(url);
  }
}
