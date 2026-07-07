import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "ffmpeg");
mkdirSync(outDir, { recursive: true });

function findFilesRecursively(dir, names, depth = 0) {
  if (!existsSync(dir) || depth > 6) return null;

  let hasAll = true;
  for (const name of names) {
    if (!existsSync(path.join(dir, name))) {
      hasAll = false;
      break;
    }
  }
  if (hasAll) return dir;

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = findFilesRecursively(full, names, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const required = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
const optional = ["ffmpeg-core.worker.js"];

const directCandidates = [
  path.join(root, "node_modules", "@ffmpeg", "core", "dist", "umd"),
  path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm"),
  path.join(root, "node_modules", "@ffmpeg", "core", "dist"),
  path.join(root, "node_modules", "@ffmpeg", "core")
];

let coreDir = null;
for (const candidate of directCandidates) {
  if (required.every((name) => existsSync(path.join(candidate, name)))) {
    coreDir = candidate;
    break;
  }
}

if (!coreDir) {
  coreDir = findFilesRecursively(path.join(root, "node_modules", "@ffmpeg", "core"), required);
}

if (!coreDir) {
  throw new Error(
    "Could not find ffmpeg-core.js and ffmpeg-core.wasm in node_modules/@ffmpeg/core. Try deleting package-lock.json and node_modules, then run npm install again."
  );
}

for (const name of [...required, ...optional]) {
  const src = path.join(coreDir, name);
  if (existsSync(src) && statSync(src).isFile()) {
    copyFileSync(src, path.join(outDir, name));
    console.log(`[copy-ffmpeg-core] copied ${name} from ${coreDir}`);
  }
}

console.log("[copy-ffmpeg-core] done");
