# osu2MuseDash Web Converter

## v0.6

This version fixes two issues:

- ffmpeg CDN loading now tries the recommended **esm** builds first for Vite, then falls back to **umd**.
- the runtime error `Cannot read properties of undefined (reading 'catch')` is fixed by removing unsafe `.catch()` calls on cleanup methods that may return `void`.

It also improves the UI:

- cleaner step bar
- more visual difficulty cards
- better select button states
- selected slot badges
- selected count badge
