# Book Effect Vision

## What I Want

Book Effect is a personal mobile app that makes reading a physical children's book aloud feel a little magical. The phone sits nearby, listens offline, follows along with the known book text, and plays contextual sound effects when specific phrases are read.

## Why I'm Building It

This is for family reading time, not a commercial product. The first goal is to make something fun for home use with books we already own. The second goal is to learn real mobile development properly: Expo, native build tooling, device testing, audio, speech recognition, TypeScript, and clean architecture.

## What Done Looks Like For V1

- I can read `Construction Site on Christmas Night` start-to-finish on the Galaxy S10 and hear 10-30 planned sound effects at the intended moments.
- On the Galaxy S10, trigger sounds start within about 1.5 seconds of the phrase being spoken, with no stale effects firing a page late.
- On the iPhone 12, the same session feels comfortably responsive, targeting about 1 second or better for most trigger fires.
- If the app loses its place, it hard-freezes trigger eligibility instead of guessing, and I can recover with a hidden manual tap.
- A 15-20 minute session runs offline with acceptable battery drain and no sustained recognizer failure.

## Non-Goals

- Reading assessment, scoring, fluency grading, or child progress tracking.
- Cloud speech recognition, cloud sync, accounts, analytics, or usage tracking.
- App Store release, onboarding flows, marketing pages, in-app purchases, or a content marketplace.
- Multi-user support, shared libraries, or scalable content management.
- Solving every children's book; v1 only needs a few hand-authored books.

## Bets

- **Bet: Offline ASR can be fast enough on the Galaxy S10.** The spike passes if at least one ASR candidate reaches p50 under 1000 ms and p95 under 1800 ms from phrase end to first audible sample.
- **Bet: One-shot audio can be effectively instant after preloading.** The spike passes if at least one audio library can fire preloaded effects with first-play latency that feels below about 50 ms on the Galaxy S10.
- **Bet: A JS matcher is good enough for the spike, but may not be good enough for v1.** The spike measures matcher cost at 5 Hz; v1 moves the matcher native only if the data says JS risks UI or latency.
- **Bet: A forward-only cursor plus trigger corridors is enough for v1.** The spike does not prove matcher quality, but v1 acceptance requires no false stale triggers during a real read-through.

## Constraints

- Offline-only recognition and playback.
- Zero per-session cost.
- Galaxy S10 SM-G973U is the gating device.
- iPhone 12 is the secondary device.
- Target latency is about 1.5 seconds on the Galaxy S10 and about 1 second on the iPhone 12.
- Expo prebuild/custom dev client is acceptable; Expo Go is not expected to work for native audio/ASR libraries.
- No paid SDKs or services without explicit approval.

## Open Questions

- Which ASR engine wins on the actual Galaxy S10: `whisper.rn` tiny.en or Sherpa-ONNX?
- Which playback path wins for one-shot effects: `expo-audio` or `react-native-sound`?
- Does the Galaxy S10 thermally throttle during a 15-minute continuous read?
- How much real child speech does v1 need to tolerate before phonetic matching becomes necessary?
- Do we ship both Android and iOS for v1, or Android-only first if Mac/iOS setup becomes a distraction?
