# osu2MuseDash Web Converter

## v1.6 extended notes in playable preview

This version adds extended-note / hold behavior to the playable conversion test.

New:
- osu! sliders that exceed the Slider hold threshold become HOLD bars in the playable preview.
- osu! spinners become HOLD bars too.
- HOLD bars have a start circle and orange tail.
- The user must keep ArrowUp / ArrowDown pressed until the tail reaches the hit circle.
- Physical on-screen buttons also support holding.
- Early release gives "Released early".
- Hold completion gives "Hold Complete".
- A Holds counter shows how many extended notes are present in the preview.

This matches the export behavior more closely: sliders/spinners that become Muse Dash hold/masher notes are now visible in the playtest.
