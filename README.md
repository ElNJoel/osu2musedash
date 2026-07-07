# osu2MuseDash

Browser-only web app that converts `.osz` / `.osu` beatmaps into a Muse Dash CustomAlbums `.mdm` draft.

## What it does

- Opens `.osz` packages locally in the browser.
- Parses `.osu` difficulties.
- Detects `osu!standard` (`Mode: 0`) and `osu!taiko` (`Mode: 1`).
- Lets you select up to 3 visible Muse Dash difficulties.
- Requires demo trim selection.
- Requires circular cover crop.
- Converts audio to `music.ogg` and `demo.ogg` using `ffmpeg.wasm`.
- Generates `info.json`, `map1.bms`, `map2.bms`, `map3.bms`.
- Packs everything as `.mdm`.

## Local setup

```bash
npm install
npm run dev
```

Open the local URL Vite prints in the terminal.

## Build

```bash
npm run build
```

The static output is in `dist`.

## Notes

This is a first-pass chart converter, not a human-quality charter. osu!taiko converts more cleanly. osu!standard uses lane policies to infer AIR/GND.
