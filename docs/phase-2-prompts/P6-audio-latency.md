# P6 — Audio playback-start latency probe

Workstream: B | Phase 2 | Run order: after [P5](./P5-gate2-human-read.md) | Next: [P7](./P7-sustained-session.md)

## Goal (one line)
Measure true command → first-audible-sample latency for `expo-audio` vs `react-native-sound` on the
S10, to settle the "playback is effectively instant after preload" bet.

## Before you start
- **Requires:** nothing in the A track (independent). Device access to the S10.
- **Consumes:** the spike app's audio providers as a starting point.
- **Read first:** `docs/05-phase-2-plan.md` (§Candor flags — the 50ms bet), `docs/00-vision.md`
  (Bet: one-shot audio instant after preload, target <~50 ms on S10), `docs/03-spike-results.md`
  (§"Audio Latency" — only proved play calls *resolve*, not first-sample timing),
  `docs/research/report-a.md` (§Q4 — expo issue #42900 "doesnt fit for sound effects"),
  `docs/research/report-b.md` (§"Playback stack" — argues `expo-audio` preload is fine),
  `spike/src/audio/ExpoAudioProvider.ts`, `spike/src/audio/ReactNativeSoundProvider.ts`.

## Context
The two research reports flatly disagree on `expo-audio` for sound effects. Phase 1 only logged
that play requests resolved (30/30 each). "Magical" depends on the *first sample* landing fast,
which was never measured. This task instruments that directly.

## Guardrails
- Offline, zero-cost. Spike is throwaway — instrument it for measurement only.
- Preload all effects and run one warmup play before timing (per `docs/01-spike-plan.md`
  methodology).
- Measure first *audible sample*, not just the resolved play promise. Use a native
  playback-start callback / first-sample signal where the library exposes one; if neither does,
  use an external acoustic capture (mic on a second device / loopback) and document the method's
  error bars.

## Scope — do this
1. Add playback-start instrumentation to both audio providers (or a thin native probe) that
   timestamps command-issued vs first-sample.
2. On the S10, preloaded + warmed: measure ≥30 one-shot fires per library; report p50/p95/max.
3. State whether either library meets the ~50 ms feel, and whether a small native player
   (SoundPool/AVAudioPlayer pool) is needed for v1.
4. iPhone 12 measurement is a **follow-on gated on [P8](./P8-ios-unblock.md)** — note it as pending,
   don't block on it.

## Out of scope
- ASR / matcher (A track). Ambient-bed playback. Building the production native player.

## Done when
- [ ] command→first-sample latency measured for both libraries on the S10 (≥30 reps each), with
      p50/p95/max and the measurement method + error bars documented.
- [ ] Clear verdict: which library for v1 one-shots, or "native player required."
- [ ] iPhone portion explicitly marked pending P8.

## Output
- Latency numbers + verdict appended to `docs/08-alignment-replay-results.md` (or a sibling
  `docs/09-audio-latency-results.md` if cleaner).

## What this leads to
- Always → [P7](./P7-sustained-session.md). No fork; result selects the v1 playback path.
