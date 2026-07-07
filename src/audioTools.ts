import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { DemoSelection } from "./types";

let ffmpegPromise: Promise<FFmpeg> | null = null;

export function secondsLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${min}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function safeTerminate(ffmpeg: FFmpeg) {
  try {
    const result = ffmpeg.terminate?.();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // ignore cleanup errors
  }
}

async function loadFromCdn(ffmpeg: FFmpeg, onLog?: (msg: string) => void): Promise<void> {
  const bases = [
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd",
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd"
  ];

  let lastError = "";
  for (const base of bases) {
    try {
      onLog?.(`Loading ffmpeg.wasm from ${base}...`);

      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm")
      });

      onLog?.("ffmpeg.wasm loaded.");
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      onLog?.(`CDN load failed: ${lastError}`);
    }
  }

  throw new Error(
    `Could not load ffmpeg.wasm from CDN. Make sure your browser can access jsDelivr or unpkg. Details: ${lastError}`
  );
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
        if (pct === 0 || pct === 25 || pct === 50 || pct === 75 || pct === 100) {
          onLog(`ffmpeg progress ${pct}% · ${Math.round(time / 1000000)}s`);
        }
      }
    });

    try {
      await loadFromCdn(ffmpeg, onLog);
    } catch (err) {
      safeTerminate(ffmpeg);
      ffmpegPromise = null;
      throw err;
    }

    return ffmpeg;
  })();

  return ffmpegPromise;
}

function extensionFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? `.${ext}` : ".mp3";
}

async function maybeDeleteFile(ffmpeg: FFmpeg, path: string) {
  try {
    const result = ffmpeg.deleteFile(path);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
  } catch {
    // ignore cleanup errors
  }
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

  await maybeDeleteFile(ffmpeg, input);
  await maybeDeleteFile(ffmpeg, "music.ogg");
  await maybeDeleteFile(ffmpeg, "demo.ogg");

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
