# P7 — Sustained continuous-read viability (unplugged)

Workstream: C | Phase 2 | Run order: after [P6](./P6-audio-latency.md) | Next: [P8](./P8-ios-unblock.md)

## Goal (one line)
Run one unplugged 15–20 minute continuous Sherpa read on the S10 and capture battery, thermal, and
recognizer-stability evidence — the missing piece from Phase 1.

## Before you start
- **Requires:** the spike's Sherpa path runs on the S10 (it does, per `spike/README.md` Task 12).
  Device access.
- **Read first:** `docs/05-phase-2-plan.md` (workstream C), `docs/00-vision.md` (V1: 15–20 min
  offline session, acceptable battery, no sustained recognizer failure), `docs/01-spike-plan.md`
  (§"Methodology" — 15-min continuous run, battery/thermal before/after),
  `docs/03-spike-results.md` (§"Battery And Thermal Notes" — only USB-powered, so incomplete).

## Context
Phase 1's battery/thermal numbers came from a USB-powered phone, so they don't represent a real
unplugged session. The vision requires a 15–20 min offline read with acceptable drain and no
sustained recognizer failure. This is a system-level risk independent of matcher correctness.

## Guardrails
- **Unplugged** for the real measurement (the whole point). Offline, zero-cost, S10 only.
- Realistic conditions: natural pauses, restarts, a child-interruption-like gap or two.
- Use `dumpsys` battery/thermal readings, not just eyeballing.

## Scope — do this
1. Fully charge, unplug, record start battery % + battery/AP/PA temps (`dumpsys`).
2. Run the spike with Sherpa for one continuous 15–20 min read with realistic pauses/restarts.
3. Record end battery % + temps; capture the recognizer-stability log (provider errors, stalls,
   dropped recognition, any crash/force-stop).
4. Report: % drain over the window, peak thermal status, and whether the recognizer stayed alive
   end-to-end.
5. If severe throttling/drain/recognizer-loss appears, note a mitigation direction (eco mode,
   shorter sessions, looser VAD) for v1 scope — do not implement it here.

## Out of scope
- Whisper (carried only as the P9 fork). Matcher quality (A track). Audio latency (P6).
- Implementing mitigations.

## Done when
- [ ] One unplugged 15–20 min continuous Sherpa read completed on the S10.
- [ ] Start/end battery % + thermal readings recorded; % drain reported.
- [ ] Recognizer-stability log captured; "stayed alive / failed" stated plainly.

## Output
- Battery/thermal/stability results appended to the Phase 2 results doc.

## What this leads to
- Always → [P8](./P8-ios-unblock.md). If a hard failure appears, insert a mitigation task before
  the (gated) v1 docs.
