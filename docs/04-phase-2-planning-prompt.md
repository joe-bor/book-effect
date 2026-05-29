# Phase 2 Planning Handoff Prompt

Use this prompt to start a fresh context from `main` for Book Effect Phase 2 planning. It intentionally asks for planning and decomposition only, not implementation.

```text
We just wrapped the Book Effect Phase 1 spike. The spike branch `codex/phase-1-spike` has been pushed and merged into `main`.

Please start from the latest `main` branch and review the current repo state first, especially:

- `docs/00-vision.md`
- `docs/01-spike-plan.md`
- `docs/02-glossary.md`
- `docs/03-spike-results.md`
- `docs/research/synthesis.md`
- `docs/research/report-a.md`
- `docs/research/report-b.md`
- `spike/README.md`
- `spike/AGENTS.md`
- `spike/src/session/SpikeSession.ts`
- `spike/src/matcher/naiveMatcher.ts`
- `spike/src/ui/SpikeScreen.tsx`

Phase 1 closeout summary:

- Android ASR comparison is decision-quality enough for Phase 2 planning.
- Sherpa-ONNX is the default Android offline ASR candidate.
- Whisper recognized the carriers well, but the current `whisper.rn` realtime pipeline was too slow on the Galaxy S10 and should only be carried as an explicit realtime rework spike.
- The current exact matcher must not carry forward unchanged.
- Phase 2 should prioritize forward-only fuzzy/token matching with trigger corridors before considering a full phoneme pipeline.
- Phoneme-based matching remains a likely future robustness direction, but needs evidence that fuzzy word/token matching fails on real sessions or child speech.
- True audio playback-start latency remains unresolved for both `expo-audio` and `react-native-sound`.
- Matcher JS cost remains unresolved.
- Sustained continuous-read battery/thermal evidence is incomplete.
- iOS remains blocked by the duplicate RNFS native symbol issue recorded in `spike/README.md`.
- Raw counted trial artifacts were collected under `/private/tmp/book-effect-asr-comparison/` but are not committed.

Important guardrails:

- Do not start Phase 2 implementation yet.
- Do not write a PRD, architecture doc, or test plan until we agree on the Phase 2 breakdown.
- Treat the spike app as throwaway measurement code, not v1 product code.
- Keep Galaxy S10 as the gating Android device.
- Keep the app offline-only and zero per-session cost.

Please help break Phase 2 into planning tracks and decision points. I want a founder-friendly explanation plus an engineer-ready decomposition.

Answer these first:

1. What are the smallest Phase 2 workstreams that can independently reduce risk?
2. Which workstream should happen first, and why?
3. What evidence would let us keep Sherpa + fuzzy matching?
4. What evidence would force a Whisper realtime rework track?
5. What evidence would justify jumping to phoneme matching earlier?
6. What should be explicitly out of scope for Phase 2?
7. What docs should we create next, in what order?

Use tables where they make tradeoffs clearer. Use diagrams where pipeline or decision flow is easier to understand visually. Be candid and concrete.
```
