import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "ffmpeg");
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);

function findCoreDir() {
  const pkgJson = require.resolve("@ffmpeg/core/package.json");
  const pkgDir = path.dirname(pkgJson);
  const candidates = [
    path.join(pkgDir, "dist", "umd"),
    path.join(pkgDir, "dist", "esm"),
    path.join(pkgDir, "dist")
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir);
    if (files.includes("ffmpeg-core.js") && files.includes("ffmpeg-core.wasm")) return dir;
  }

  throw new Error("Could not find ffmpeg-core.js / ffmpeg-core.wasm inside @ffmpeg/core.");
}

const coreDir = findCoreDir();
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"]) {
  const src = path.join(coreDir, name);
  if (existsSync(src) && statSync(src).isFile()) {
    copyFileSync(src, path.join(outDir, name));
    console.log(`[copy-ffmpeg-core] copied ${name}`);
  }
}
