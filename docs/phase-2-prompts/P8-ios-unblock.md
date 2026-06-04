# P8 — iOS native unblock (duplicate RNFS symbol)

Workstream: D | Phase 2 | Run order: after [P7](./P7-sustained-session.md) | Next: end of core sequence

## Goal (one line)
Resolve the duplicate RNFS native symbol so the spike builds and launches on the iPhone 12 — or
make a written, justified decision to defer iOS for Phase 2.

## Before you start
- **Requires:** nothing (independent). Mac with full Xcode + CocoaPods, iPhone 12.
- **Read first:** `docs/05-phase-2-plan.md` (workstream D; iOS is **not** a Phase 2 gate),
  `spike/README.md` (§"Task 12 Local Build Notes" — the failure: both `react-native-fs@2.20.0`
  and `@dr.pogodin/react-native-fs@2.38.2` link as iOS Pods, `RNFS` + `ReactNativeFs`),
  `spike/AGENTS.md` (read the pinned Expo v56 docs before changing native config).

## Context
The S10 is the gate and is unblocked. iOS is the secondary device and is currently dead on
arrival: the iOS build fails with duplicate RNFS symbols because two react-native-fs forks are
both linked. This is a contained dependency-graph problem, not a product risk — so it is explicitly
*not* allowed to block the gate-defining work, and deferral is an acceptable outcome.

## Guardrails
- Do not destabilize the working Android build to fix iOS.
- Offline, zero-cost; no paid SDKs.
- Read the pinned Expo v56 docs (per `spike/AGENTS.md`) before editing native config / Podfile.
- Treat the spike as throwaway — the goal is "does it run," not a clean dependency architecture.

## Scope — do this
1. Trace which dependency pulls each RNFS fork (`npm ls react-native-fs @dr.pogodin/react-native-fs`,
   Podfile.lock).
2. De-duplicate to a single RNFS implementation (dedupe/override the transitive dep, or pin one
   fork), regenerate Pods, and rebuild for the iPhone 12.
3. Launch the spike on the iPhone 12 and confirm the UI opens and a manual sound trigger plays.
4. If de-duplication proves disproportionately costly, write a short deferral decision (cost,
   what it blocks — only the iPhone half of P6 — and when to revisit) instead.

## Out of scope
- iOS-specific ASR/audio measurement (that follows once it builds).
- Any A-track work.

## Done when
- [ ] iOS build succeeds and the spike launches on the iPhone 12 with a working manual trigger;
      **or**
- [ ] A written deferral decision with rationale is recorded.

## Output
- Updated `spike/README.md` build notes, **or** a deferral note in the Phase 2 results doc.

## What this leads to
- End of the core sequence. If it builds, it unblocks the iPhone half of [P6](./P6-audio-latency.md).
  No fork.
