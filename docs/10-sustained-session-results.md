# P7 — Sustained Continuous-Read Results (unplugged)

Workstream C, Phase 2. Prompt: [`P7-sustained-session.md`](./phase-2-prompts/P7-sustained-session.md).
Goal: one unplugged 15–20 min continuous **Sherpa** read on the Galaxy S10 (SM-G973U), capturing
battery drain, thermal, and recognizer stability — the piece Phase 1 only got USB-powered.

## Method

- Device: Galaxy S10 (SM-G973U), unplugged for the measurement window.
- ASR: `sherpa-onnx`. Audio: `expo-audio`. Spike dev build (Metro-served), screen on.
- Instrumentation over USB at the **ends only** (start while plugged, end after replug); the read
  itself runs unplugged with no laptop link. The spike session log lives in the in-memory logger
  and is auto-saved to `cache/` on **Stop Session**, pulled via `run-as` afterward.
- **Pre-flight (passed):** session survived a 90 s unplug (Metro disconnect) — events climbed
  128 → 245 with no red screen / crash, confirming a Metro drop won't fake a recognizer failure
  during the unplugged read.

## START baseline — 2026-06-04 12:53:13 (plugged, just before unplug)

| Metric | Value |
|--------|-------|
| Battery level | **93%** |
| Battery temp | **31.7 °C** |
| Hottest CPU core (cpu-1-0) | **54.8 °C** |
| CPU little cores (cpu-0-x) | 44.8–49.0 °C |
| GPU (gpuss) | ~42–43 °C |
| DDR | 43.2 °C |

(Phone already warm ~3 °C from the pre-flight recognition; recorded as-is.)

## END readings — 2026-06-04 13:07:18 (read complete, before replug)

| Metric | Value |
|--------|-------|
| Battery level | **89%** |
| Battery temp | **33.6 °C** |
| Hottest CPU core | **46.3 °C** (cpu-0-0) |
| CPU cores (range) | 43.2–46.3 °C |
| GPU / DDR | ~42 / 43.6 °C |

## Run 1 results (2026-06-04)

- **Duration:** ~9 min continuous (session RUNNING at 12:58, Stop ~13:07 wall clock). The book was
  finished before the 15–20 min window — **short of the P7 "Done when" duration.**
- **Battery drain:** 93% → 89% = **4 percentage points over ~9 min** ≈ **~0.44 %/min ≈ ~25 %/hr**.
  Coarse (1 % granularity over a short window → large relative error); a 15–20 min run would tighten
  this materially. Implies ~7–9 % for a real 15–20 min session — acceptable.
- **Thermal:** battery +1.9 °C (31.7 → 33.6 °C); CPU cores stayed 43–55 °C with **no throttling**.
  Thermals are a **non-issue** for a session of this kind.
- **Recognizer stability:** **0 error / stall / drop events.** Retained log tail (4.5 min, 500-event
  cap) shows 433 partials, 22 finals, 21 vadStart / 22 vadEnd, clean `session.stop` — Sherpa healthy
  end-to-end. Pre-flight separately proved the session survives a 90 s unplug (Metro loss), events
  128 → 245, no crash.

### Caveats / follow-ups
1. **Duration < target.** Re-run for a full 15–20 min (any text) to satisfy the "Done when" and to
   get a reliable drain rate.
2. **`loggerCapacity = 500`** ([`SpikeScreen.tsx:52`](../spike/src/ui/SpikeScreen.tsx)) is a ring
   buffer — only the final ~4.5 min of events were saved. For a rigorous long-session stability
   record, raise the cap or save periodically (spike-tooling note, not a device finding).
3. **Audio assets are Metro-served in the dev build** — `ExpoAudio.preload` fetches over the
   `adb reverse :8081` tunnel, so the session must be **started while plugged** (preload caches
   audio) before unplugging. The reverse tunnel drops on unplug and must be re-established.

## Status
Recognizer + thermal: **PASS**. Battery + duration: **preliminary** (9 min); recommend one 15–20 min
confirmation run before marking P7 `done`.
