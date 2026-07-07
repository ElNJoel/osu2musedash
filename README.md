# osu2MuseDash Web Converter

Browser-only web app that converts `.osz` / `.osu` beatmaps into a Muse Dash CustomAlbums `.mdm` draft.

## v0.4 Cloudflare Pages fix

Cloudflare Pages has a 25 MiB limit per static asset. `ffmpeg-core.wasm` is about 30 MiB, so this version does **not** ship that WASM file inside the deployment.

Instead, the app loads `@ffmpeg/core` from jsDelivr/unpkg at runtime and converts it into a Blob URL using `toBlobURL`. That keeps the Cloudflare deployment small while still converting audio in the browser.

## Features

- Opens `.osz` packages locally in the browser.
- Detects osu!standard and osu!taiko.
- Lets you choose up to 3 visible Muse Dash difficulties.
- Visual waveform demo editor.
- Mandatory circular cover crop.
- Generates `info.json`, `music.ogg`, `demo.ogg`, `cover.png`, `map1.bms`, `map2.bms`, `map3.bms`.
- Downloads the final `.mdm`.

## Cloudflare Pages

Build command:

```bash
npm run build
```

Build output directory:

```bash
dist
```

## Local setup

```bash
npm install
npm run dev
```
