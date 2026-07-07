import JSZip from "jszip";
import { makeBmsText, makeInfoJson } from "./bmsWriter";
import { convertAudioToOggs } from "./audioTools";
import type { ConversionSettings, DemoSelection, SelectedDifficulty } from "./types";

export interface BuildMdmArgs {
  selected: SelectedDifficulty[];
  settings: ConversionSettings;
  audioFile: File;
  coverPng: Blob;
  demo: DemoSelection;
  onProgress?: (msg: string) => void;
}

export async function buildMdmPackage(args: BuildMdmArgs): Promise<Blob> {
  if (!args.selected.length) throw new Error("Select at least one difficulty.");
  if (args.selected.length > 3) throw new Error("Muse Dash visible difficulties are limited to 3.");

  const zip = new JSZip();

  args.onProgress?.("Writing info.json...");
  zip.file("info.json", makeInfoJson(args.selected, args.settings));

  args.onProgress?.("Writing BMS charts...");
  for (const item of args.selected) {
    const { text } = makeBmsText(item, args.settings);
    zip.file(`map${item.mdSlot}.bms`, text);
  }

  args.onProgress?.("Converting audio...");
  const { musicOgg, demoOgg } = await convertAudioToOggs(args.audioFile, args.demo, args.onProgress);
  zip.file("music.ogg", musicOgg);
  zip.file("demo.ogg", demoOgg);

  args.onProgress?.("Writing cover.png...");
  zip.file("cover.png", args.coverPng);

  args.onProgress?.("Packing .mdm...");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "converted";
}
