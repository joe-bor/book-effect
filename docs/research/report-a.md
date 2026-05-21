# Building a Read-Aloud Sound-Effect Engine in React Native: An Opinionated Technical Architecture

## TL;DR
- **Use `whisper.rn` (mybigday) with `ggml-tiny.en` quantized + Silero VAD + a 1.5–2 s sliding window on iOS (Core ML encoder) and Android (NNAPI/CPU) as your primary transcription path; fall back to Apple `SFSpeechRecognizer` with `requiresOnDeviceRecognition=true` and Android `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` only when Whisper RTF on a target device exceeds ~0.5.** The position cursor should be a token-level Smith‑Waterman / monotonic local-alignment matcher with a forward-only ratchet, run in a native (Swift/Kotlin) module — not in JS — over a rolling 120-token book window centered on the cursor. For audio playback, preload every trigger as a decoded `AVAudioPlayer` (iOS) / `SoundPool` (Android) instance at session start, exposed through `react-native-sound` or a tiny custom Nitro module; `expo-audio`/`expo-av` introduce 100–400 ms of first-play latency and should not be used for the trigger fires.
- **Novel Effect's own patents (US 11,526,671 and US 11,501,769) show they deliberately do NOT do speech-to-text — they compute phoneme edit distance directly between audio-derived phonemes and the book's phonemes.** That is the right architectural insight for the kill-or-validate spike: a phoneme-pipeline avoids whisper's "hallucinate full sentences" failure mode that almost certainly drives the "freezes for 3-5 pages, loops ambient music" reviews. But it requires a phoneme recognizer (Vosk graph-constrained, or Apple's Speech framework word-timing output mapped through CMU dict), so the pragmatic v1 is still token-based with whisper + a constrained vocabulary prompt, with phoneme-distance as the v2 robustness upgrade.
- **The single biggest risk to prototype first is end-to-end partial-hypothesis latency on a mid-range Android device (Pixel 6 / Galaxy A-series), not the matcher.** If whisper-tiny + 1.5s window can't produce a usable partial within ~700 ms after the phrase is spoken on Android, the entire architecture is dead and you must drop to `react-native-voice` / Android `SpeechRecognizer` (with all its 10-second-silence-cutoff baggage). Spike this with a stopwatch and ten test phrases before writing any matcher code.

## Key Findings

1. **Novel Effect does not use speech-to-text.** US Patent 11,526,671 claim 7: *"performing the phonetic comparison comprises comparing the audio data and the text source without any conversion of the audio data to text using speech recognition."* Their core trick is phoneme edit distance plus a "correspondence measure" over a sliding sequence (US 12,315,533 claim 12). Their FAQ confirms on-device ASR powered by Keen Research's KeenASR SDK. This explains both their strengths (works with re-reads, accents, low literacy) and the failure mode users report: when the correspondence measure drops below threshold for "a threshold duration of time" (US 12,315,533 claim 13) the cursor stops advancing and the soundscape loops the ambient bed — which is exactly what users describe as "freezes for 3-5 pages." It is not a bug; it is the explicit fallback in their patent.
2. **`react-native-voice` is unsuitable as the primary path.** On Android, Google's `SpeechRecognizer` cuts off after the first ~10 s of silence, sometimes earlier, and continuous mode is only available on Android 13+. On iOS, Apple imposes a 1-minute-per-request limit on `SFSpeechRecognitionRequest` server mode and a documented 1000-requests-per-hour device throttle; on-device mode lifts the 1-minute cap but partial-hypothesis behaviour on iOS 18+ has been reported to clear prior text after 1-2 s pauses (Apple Developer Forums). Stitching restarts cleanly across a 20-minute read is achievable but fragile; it is fine as a fallback, not a foundation.
3. **whisper.rn is production-ready for this exact use case.** The `RealtimeTranscriber` API (added in 2025, current 0.5.x) wires `@fugood/react-native-audio-pcm-stream` → Silero VAD (`ggml-silero-v6.2.0.bin`) → a sliding `audioSliceSec` window (default 30 s, but can be set lower) → whisper.cpp with Core ML encoder on iOS. `tiny.en` (39 M params, ~75 MB ggml, ~31 MB Core ML) is the right model: 5.66% WER on LibriSpeech test-clean per the openai/whisper-tiny.en Hugging Face model card evaluation (Radford et al., arXiv:2212.04356), faster than real-time on every device shipped since 2019. `base.en` (74 M, ~142 MB) achieves 4.27% WER on LibriSpeech test-clean per the openai/whisper-base.en Hugging Face model card — only ~24% more accurate than tiny.en (4.27% vs 5.66%) but 2-3× slower; reserve it for tablets / iPhone 13+.
4. **Realistic numbers on a mid-range phone.** The canonical whisper.cpp benchmark thread (ggerganov/whisper.cpp issue #89, commit fcf515d) reports iPhone 13 Mini, iOS 16.0, NEON BLAS, 4 threads, base model — encoder time **1091 ms** per 30 s mel chunk (Load: 97 ms), RTF ≈ 0.036 encoder-only; tiny is ~5× faster. WhisperKit's device matrix caps A12/A13 (iPhone Xs / 11 / 12-class) at tiny/base only. On Android, per VoicePing's "Offline Speech Transcription Benchmark: 16 Models Across Android, iOS, macOS, and Windows" (Akinori Nakajima, VoicePing, February 15, 2026): *"the choice of inference engine can change performance by 51x for the same model (sherpa-onnx vs whisper.cpp on Android)"* — worth evaluating if you ship a custom dev client. Plan for **~300–700 ms per 1.5 s window inference on Pixel 6** as your design budget; if you blow that, drop to `tiny.en` quantized q5_1 or switch to Vosk small (50 MB) which has true streaming and zero per-chunk warmup.
5. **The matcher is a solved problem; the implementation is what kills people.** A token-level local alignment (Smith-Waterman with affine gap, match = +2, mismatch = -1, gap = -1) over a 60-120 token window of the book centered on the cursor, run on every partial-hypothesis emission, is overwhelmingly the right approach. JS implementations (fuse.js, fastest-levenshtein, didyoumean2) are usable up to ~500 tokens but will jitter the JS thread at >10 Hz; the alignment should live in Swift/Kotlin (~50 lines) called via a Nitro/TurboModule. Phonetic backoff via Double Metaphone catches the common ASR error class ("rode" / "road", "won" / "one") and is critical for child speech.
6. **Audio playback in Expo is the underappreciated landmine.** `expo-audio` does NOT preload — its `downloadFirst` only downloads, it does not pre-decode into a hot buffer. From expo/expo GitHub issue #42900 (SDK 54), verbatim: *"This means `expo-audio` doesnt fits for **sound effects** or UI sound interaction like clicks or other short sound audio which must be played with **low latency** so user can feel it naturally."* The same issue clarifies that `downloadFirst` "only downloads file via `downloadAsync` to temp folder … it doesnt do anything related to improve buffering." First-play latency on cold AAC/MP3 in `expo-av` is 100-400 ms; for sound effects this is the difference between "magical" and "broken." Use `react-native-sound` (AVAudioPlayer / Android MediaPlayer) with `prepareToPlay` called at session start for every trigger, or build a 30-line Nitro module wrapping `SoundPool` (Android) + `AVAudioPlayer` pool (iOS) for sub-50 ms playback start.

## Details

### Q1 — On-device speech recognition: Whisper-tiny.en via whisper.rn, with platform-native fallback

**Recommendation: whisper.rn 0.5.x with `ggml-tiny.en-q5_1.bin` + Silero VAD + Core ML encoder on iOS.** This is the most reliable free/offline path to a continuous transcription stream in Expo today, period. You will need EAS prebuild / custom dev client — accept this, it's a one-time cost.

**Reasoning.** Every alternative has a disqualifying flaw for *continuous read-aloud* (not short commands):

| Option | Disqualifier |
|---|---|
| `@react-native-voice/voice` | Android cuts off at ~10 s silence; iOS partial-hypothesis behavior degraded in iOS 18 (clears prior text on 1-2 s pause per Apple Developer Forums). |
| `expo-speech-recognition` (jamsch) | Better wrapper than react-native-voice (continuous mode on Android 13+, on-device controls), but still bound to the same OS engines' restart fragility. Excellent **fallback**, not primary. |
| Apple `SFSpeechRecognizer` direct | On-device mode is good on iOS 13+ A12+ devices but Android is unsolved. Different code paths × maintenance. |
| Android `SpeechRecognizer` + `EXTRA_PREFER_OFFLINE` | "Prefer" not "require"; falls back to Google cloud unpredictably. Continuous only Android 13+. |
| Vosk (`react-native-vosk`) | 50 MB models, truly streaming, zero warmup. WER significantly worse than whisper-tiny on noisy / child speech. Solid **secondary fallback** and the right pick if you ever go phoneme-distance (Vosk exposes word-level Kaldi lattices). |
| Picovoice Leopard / Cheetah | Paid; per-session licensing kills "near zero cost per session." |
| Kaldi raw | No RN binding, too heavy. |
| ONNX Runtime / ExecuTorch | Strictly better long-term path (sherpa-onnx Whisper-tiny is 51× faster than whisper.cpp on Android per VoicePing) but the RN bindings are immature in 2026. |
| KeenASR (what Novel Effect uses) | Closed source, commercial license, not free. Worth a license inquiry if v1 is successful — they advertise "track reading progress word-by-word, detect insertions, deletions, and substitutions." |
| TFLite Whisper (e.g. `rn-whisper-stt`) | Tiny model works but no streaming primitive; you'd build the windowing yourself. |

**Model size: `tiny.en` (or quantized `tiny.en-q5_1`).** `base.en` is materially more accurate (LibriSpeech test-clean WER 4.27% vs 5.66%) but 2–3× slower. Your matcher is doing fuzzy alignment against known text — it absorbs WER. Latency matters more. On iPhone 12 / Pixel 6 class hardware, expect:

- `tiny.en` 1.5 s window with VAD-gated decode: **~150–400 ms inference** (iOS Core ML encoder), **~300–700 ms** (Pixel 6 CPU). RTF ~0.1–0.3.
- `base.en` same window: **~400–1100 ms** iOS, **~800–1800 ms** Android.
- Cold load (first decode after init): add 300–800 ms on iOS for Core ML compile.
- Battery: Whisper on Core ML / ANE is ~5–8 %/hour. CPU-only Android is ~15–20 %/hour — watch this on Android One devices.

**Whisper.rn streaming/VAD specifics.** The `RealtimeTranscriber` (NOT the deprecated `transcribeRealtime()`) accepts a `WhisperVadContext` (Silero v6.2.0 GGUF, ~2 MB) and triggers transcription on `autoSliceOnSpeechEnd`. Default `audioSliceSec` is 30 — for your use case override to 2 with a 0.5 s VAD silence threshold. The legacy `transcribeRealtime()` is documented as deprecated in the whisper.rn README and has known Android lag.

**Main risk / failure mode.** Whisper hallucinates on silence and on background music (the trigger sound playing back through the phone's speaker IS background music to the next window). Two mitigations: (a) **gate every inference on Silero VAD** — no speech → no decode → no hallucination; (b) suppress the input audio energy in the band where your trigger is currently playing, or duck the trigger sounds 6 dB during the 200 ms after they fire. Without (a) you will see the reviewer-reported "play the same sound effect for 3-5 pages" symptom: whisper transcribes the wrong text from its own music, the matcher fires the wrong trigger, repeat.

**Fallback.** `expo-speech-recognition` (jamsch) with `requiresOnDeviceRecognition: true` on iOS and `androidIntentOptions: { EXTRA_PREFER_OFFLINE: true, EXTRA_LANGUAGE_MODEL: "free_form" }` on Android. Wrap it with auto-restart on `onSpeechEnd` and stitch partials. Accept that Android <13 will have 5-15 s blackouts. Use whisper.rn detection as the primary; if init fails or RTF measured during the first 10 s exceeds 0.6, hot-swap to expo-speech-recognition for that session.

**Worth investigating:** `mybigday/whisper.rn` `RealtimeTranscriber`, `@fugood/react-native-audio-pcm-stream`, `sherpa-onnx` for Android, `argmaxinc/WhisperKit` for iOS-only future, the Whisper paper (Radford 2022 §3.5 on hallucination), Local Agreement decoding (Macháček et al. 2023), Simul-Whisper truncation detection (arxiv 2406.10052) for the chunk-boundary bug.

### Q2 — Position tracking: monotonic Smith-Waterman over a token window with phonetic backoff

**Recommendation: a forward-only token cursor, advanced by a Smith-Waterman local alignment between the last ~30 ASR tokens and the next ~120 tokens of the book starting from the cursor.** Run it natively (Swift/Kotlin) on every partial-hypothesis emission. Accept advances only when the alignment score exceeds a threshold AND the matched book-side span starts within the lookahead window. The cursor is a monotonic max — it never moves backward, only ratchets forward.

**Reasoning.** This problem is structurally identical to bioinformatics local alignment and to the long-form forced-alignment problem (SailAlign, CTC segmentation, MFA). The reader's spoken token sequence is a noisy, gappy, possibly-out-of-order subsequence of the book; you want the best local alignment that starts at-or-after your current cursor. Smith-Waterman with affine gaps (match +2, mismatch −1, gap_open −2, gap_extend −1) over ~30 × ~120 tokens = 3,600 cells × 4-byte int = 14 KB per evaluation. Trivial.

- **Window size:** lookahead 60-120 tokens (≈ a page of a picture book), lookbehind 10-20 tokens (catches "the the the" stutters and re-reads of the current sentence).
- **Don't use Levenshtein over the entire transcribed string**: it grows O(N·M) and re-computes on every partial. Use the alignment ONLY against the window.
- **Don't use Jaccard / BM25 / cosine on n-grams**: they ignore order, which is exactly the information you need on "goodnight moon" appearing 12 times. Order is the whole point.

**Algorithm sketch (pseudo, native):**

```
on partial_hypothesis(tokens):
  recent = last 30 tokens of rolling ASR buffer    // bounded
  window = book[cursor - 10 .. cursor + 120]
  result = smith_waterman(recent, window, match=+2, mismatch=-1, gap=-1)
  if result.score >= score_threshold(len(recent)) and result.book_start >= cursor - 5:
       new_cursor = book.indexOf(result.book_end) + 1
       cursor = max(cursor, new_cursor)         // monotonic ratchet
       confidence = result.score / max_score(len(recent))
  else:
       confidence *= 0.92    // exponential decay
```

**Tokenization & normalization.** Lowercase; strip punctuation; collapse contractions ("don't" → "do n't" → match either way); keep a parallel phonetic index per token using Double Metaphone (the `natural` library port works in RN but is slow; reimplement the 100-line algorithm natively). Match score = exact = +2, metaphone-equal = +1, otherwise −1. This solves "rode/road," "won/one," and most child mispronunciations cheaply.

**Hysteresis & confidence tuning (no calibration step).** Cursor confidence starts at 1.0. Each successful advance with normalized score ≥0.6 sets it to that score; each miss decays by ×0.92. Eligibility window for triggers scales with confidence (see Q3). Below 0.3, enter "search mode" (Q5).

**Handling the hard cases:**

- **Re-reads:** monotonic ratchet handles them automatically. The reader re-reads page 4; the window is centered ahead at page 5; alignment still scores well enough because the lookbehind catches it, but cursor doesn't move backward. Triggers in the re-read region are already marked done, so they don't re-fire.
- **Pauses:** VAD gates decoding. No tokens → no cursor change. Confidence decays gently. Sound effects continue from where they were.
- **Garbled audio / child babble:** alignment score drops, threshold not met, cursor holds. After 3-5 failed evaluations confidence drops below 0.3 → search mode.
- **Reader skips ahead:** lookahead of 120 tokens covers ~30 s of reading. If they skip a paragraph, the alignment still finds a strong match further into the window. If they skip a whole page (>120 tokens), confidence drops and after a few seconds you widen lookahead to the entire remainder of the book for one "resync" attempt (cheap — still <50 KB DP table for a 20 K-token book). Take the best match if score > tighter threshold; otherwise stay put.
- **Skipping back / starting over:** by design ignored. A long-press "I'm on this page" recovery (Q5) is the escape hatch.

**JS libraries.** Don't run this in JS. But if you must prototype in JS first:
- `fastest-levenshtein` — actually the fastest JS edit-distance, ~10× faster than `fast-levenshtein` per its own benchmarks.
- `fuse.js` — fine for one-shot search, not for streaming.
- `string-similarity` — Dice coefficient, useless here (ignores order).
- `natural` — has Metaphone, Soundex, Double Metaphone but heavy.
- Skip `didyoumean2` and `leven` — neither gives you alignment offsets.
- For the actual Smith-Waterman the cleanest reference is the Wikipedia pseudocode; alternative: `ts-fuzzy` does NOT do local alignment despite the name.

**Main risk / failure mode.** Threshold tuning. Too strict → cursor freezes on noisy audio (the Novel Effect failure mode). Too loose → cursor races ahead on the wrong matches and triggers fire on phrases the reader hasn't said yet. Tune threshold = `0.45 * len(recent) * match_score` as starting point; collect real session traces in beta and tune per-book.

**Fallback.** Run a parallel cheap "anchor matcher": precompute n-gram (4-shingle) hashes of every trigger phrase and 5-token spans every 10 tokens in the book. Match recent ASR n-grams against this hash table directly. If alignment is failing but anchor matcher hits an n-gram strongly forward of the cursor, jump the cursor there. This is your no-confidence resync.

**Worth investigating:** Smith-Waterman (Smith & Waterman 1981), CTC Segmentation (Kürzinger 2020), SailAlign (Katsamanis 2011) for long-noisy alignment, the WhisperX paper (Bain 2023) for the forced-alignment-after-ASR pattern, Local Agreement decoding for chunk-boundary stability.

### Q3 — Trigger firing: partials, eligibility windows, and the "goodnight ×12" problem

**Recommendation:** maintain three things — (a) a **priority queue of upcoming triggers** ordered by `wordIndex`, (b) the cursor from Q2, and (c) a **2-3 s recent-transcription ring buffer**. A trigger becomes *armed* when `cursor >= trigger.wordIndex - armingLead` (armingLead ~ 5 words). For an armed trigger, run a phrase-specific match (not the global Smith-Waterman) against the ring buffer on every partial. Fire when the phrase-match crosses a phrase-length-dependent threshold; immediately mark done.

**Partials vs finals.** Use **partial / interim** hypotheses for trigger detection. Whisper.rn emits partials per VAD segment; you cannot wait for a "final" (it can be 5-15 s away when the reader pauses). The matcher must be idempotent — the same partial may be re-emitted with corrections.

**Match against recent buffer, NOT full transcription.** A 2-3 s ring buffer (~7-10 words of recent ASR output) is the right scope. Matching against the full session transcription causes phrases earlier in the book to re-trigger on echoes and re-reads. The ring buffer also auto-prevents double-fires: if a 3-word phrase is fully within the buffer and matches, you fire; before the next partial arrives, the matched span scrolls partly out, so it can't re-match. Hard belt-and-braces: also keep a 1.5 s cooldown per `trigger.id` after firing.

**Phrase-length-aware matching.**
- **Single-word triggers ("roar", "boom")** — exact match OR Metaphone-equal in the ring buffer. Confidence is binary; fire on first hit. These have the highest false-positive risk; if the word appears in adjacent narrative ("the roaring fire was loud, then the lion went ROAR"), you'd fire twice. Use the `wordIndex` to disambiguate: an exact match within ±8 words of the expected position fires; further is rejected.
- **Multi-word triggers ("goodnight moon", "the very hungry caterpillar")** — Smith-Waterman score of the *phrase* against the ring buffer, normalized by phrase length; threshold ~0.7. Penalize gaps heavily for short phrases. Order matters.
- **Sentence-level triggers** — wait for ≥60 % of the tokens to have aligned through the matcher, then fire on the leading-edge token.

**Expiry window.** Trigger expires when `cursor > trigger.wordIndex + maxLookback`. Sensible defaults:
- Single word, common: `maxLookback = 8 words` (≈ 3 s of reading). Otherwise you'll fire on the next paragraph.
- Single word, distinctive: `maxLookback = 20 words`.
- Multi-word phrase: `maxLookback = 40 words` (~ a paragraph, ~12 s).
- "Sentence" / scene-setter: `maxLookback = 80 words` (~ a page).
Don't use the same "30/50/paragraph" globally — it overfires on commons and underfires on distinctives.

**The "goodnight ×12" problem.** Each occurrence is a separate trigger keyed by `wordIndex`. The arming mechanism solves this automatically: only the next-upcoming "goodnight" trigger in the priority queue is *armed* at any time. When it fires, dequeue, mark done, arm the next. The phrase matcher never sees triggers that are not armed.

**Double-fire prevention layers (defense in depth):**
1. Trigger removed from queue on fire (primary).
2. Per-trigger 1.5 s cooldown (catches the child echo case).
3. Ring buffer scroll naturally prevents same-buffer re-match.
4. Reject any phrase match whose start position in the book is more than `2 × maxLookback` behind the cursor (catches echoes that drift the buffer).

**Main risk / failure mode.** Whisper partial latency on Android exceeds 1 s, breaking the "fire within 1 s" requirement on multi-syllable triggers near end-of-utterance. **Mitigation: predictive arming + early-arm matching against any *prefix* of the trigger phrase.** Example: trigger phrase is "fire truck siren". When cursor reaches `wordIndex - 5` and the ring buffer contains "fire truck", begin loading the audio buffer and start the play call asynchronously. If "siren" doesn't arrive within 800 ms, cancel.

**Fallback.** If no partials are produced for 4 s while VAD shows speech (whisper stalled), fall back to "phrase listening mode": continue running a cheap acoustic phrase spotter (Picovoice Porcupine has a free tier for wake-word style detection, supports custom phrases; this is non-zero cost but worth it for distinctive triggers). Re-engage whisper when the next final hypothesis lands.

**Worth investigating:** Picovoice Porcupine for wake-word-style phrase spotting as a redundant detector for high-value triggers, the "wake-word + ASR" two-stage pattern, the dejavu / Shazam-style acoustic fingerprinting if you go fully phoneme-free (see Q5/Novel Effect).

### Q4 — Latency budget and audio sync

**End-to-end target: 800 ms p50, 1200 ms p95 from end-of-phrase-spoken to first audible sound-effect sample.**

Latency budget on iPhone 12 / Pixel 6:

| Stage | iOS budget | Android budget | Where the time goes |
|---|---|---|---|
| Microphone capture buffer | 20-40 ms | 40-80 ms | AVAudioEngine 1024-frame buffer @16 kHz / AudioRecord ring buffer |
| VAD decision (Silero) | 10-20 ms | 20-40 ms | per ~30 ms frame |
| Encoder buffering until window slice | 200-500 ms | 200-500 ms | dominated by your `audioSliceSec`/VAD-end choice; this is the single biggest knob |
| Whisper-tiny.en inference (1.5 s window) | 150-400 ms | 300-700 ms | Core ML ANE on A12+, CPU on Android (unless sherpa-onnx) |
| JS bridge (native → JS) | 5-30 ms | 10-50 ms | New Architecture / Nitro is ~5 ms; legacy bridge can spike to 50 ms under JS load |
| Matcher + trigger eval | 1-5 ms | 1-5 ms | native Smith-Waterman is ~1 ms on 30×120 |
| Audio decode | 0 ms | 0 ms | if pre-decoded in memory (mandatory) |
| Audio playback start | 10-40 ms | 30-80 ms | AVAudioPlayer.play / SoundPool.play |
| **Total** | **~400-1000 ms** | **~600-1500 ms** | |

Critical observations:
1. **The slice/VAD buffering dominates.** A 1.5 s window means a phrase that ends mid-window has to wait for the rest of the window before whisper decodes. **Use VAD-end-triggered decoding** (`autoSliceOnSpeechEnd: true`) so a short utterance fires the decode immediately on the silence-end, not at the 1.5 s mark.
2. **Predictive arming gets you back ~300 ms.** If the trigger is armed and you have a partial that's a prefix of the phrase, prefetch and queue the playback call with `volume = 0`, then ramp on confirmation. AVAudioPlayer `prepareToPlay` and `play` separated by JS work is the standard pattern; `SoundPool.load` returns immediately and `play` is ~10 ms.
3. **Pre-warm the audio session.** On iOS, `AVAudioSession.setActive(true, options: [.notifyOthersOnDeactivation])` with `.playAndRecord` category + `.measurement` mode + `.defaultToSpeaker` should be done at session start. First `play()` after a cold session is 80-200 ms. Subsequent are 10-40 ms.
4. **Don't use `expo-av` `Audio.Sound` for trigger fires.** Cold first-play has been measured at 100-400 ms even after `loadAsync`. The `expo-audio` (new) replacement still lacks true sound-preloading — verbatim from expo/expo GitHub issue #42900 (SDK 54): *"This means `expo-audio` doesnt fits for sound effects or UI sound interaction like clicks or other short sound audio which must be played with low latency so user can feel it naturally."* The same issue clarifies that `downloadFirst` only downloads to a temp folder via `downloadAsync` and "doesnt do anything related to improve buffering." Use it for the ambient music loop only.

**Recommendation for one-shot playback:**

- **iOS:** wrap `AVAudioPlayer` in a tiny native module. Create one player instance per trigger at session start, call `prepareToPlay()`. To fire: `play()`. Sub-50 ms reliably.
- **Android:** `SoundPool` for sub-second one-shots (built for game SFX, mixes up to 32 streams, ~10-30 ms start). For longer ambient stings (>5 s), `MediaPlayer` or ExoPlayer.
- **In RN/Expo today:** `react-native-sound` is the closest off-the-shelf wrapper and uses exactly these primitives (AVAudioPlayer + Android MediaPlayer, though the new fork uses some `SoundPool` paths). It's not on the new architecture by default but works. `react-native-nitro-sound` is the Nitro-rewrite of `react-native-audio-recorder-player` — better arch fit, primarily for record/playback of single files, not optimized for a SFX pool yet.
- **The right thing to build:** a 100-line Nitro module that takes `{ id, asset }[]` at init, decodes everything into an AVAudioPlayer pool (iOS) / SoundPool (Android), and exposes `playOneShot(id)` synchronously. Two days of native work; eliminates the entire playback-latency category.

**Audio session caveats:**
- You must use `playAndRecord` category to listen and play simultaneously.
- Set `.duckOthers` for the ambient bed so the reader's voice is captured cleanly.
- iOS: the trigger sound played back through the speaker bleeds into the mic; if Bluetooth speaker is connected (Novel Effect's recommended setup), this is largely fixed. For phone-speaker case, consider noise gating in your Silero VAD threshold.

**Worth investigating:** `react-native-nitro-audio-manager` (gives `getOutputLatency()` and `getInputLatency()` precisely), Expo blog "Real-time audio processing with Expo and native code" (Tuneo guitar tuner case study showing how to do this), AudioKit AVAudioEngine patterns.

### Q5 — Robustness, fallback, and what Novel Effect actually does

**Patent evidence: Novel Effect computes phoneme edit distance directly on audio, deliberately bypassing speech-to-text.**

This is the single most important architectural fact in this entire research. Verbatim from US 11,526,671 claim 7: *"performing the phonetic comparison comprises comparing the audio data and the text source without any conversion of the audio data to text using speech recognition."* From claim 4: *"performing the phonetic comparison comprises calculating a phoneme edit distance between phoneme data of the audio data and phoneme data of the text source."* And from US 12,315,533 claim 12-13, they compute a *"correspondence measure based on a plurality of phoneme edit distances"* and detect off-script when *"the correspondence measure is below ... a threshold value for a threshold duration of time."*

This means:
- Novel Effect's "freezes for 3-5 pages" is **the documented fallback in the patent**, not a bug. When the phoneme correspondence drops below threshold for "a threshold duration" the system enters a hold state and likely deactivates the mic (US 12,315,533 claim 9/16 explicitly describes signaling to *"deactivate one or more microphones"* on discontinuation).
- They use Keen Research's KeenASR SDK (confirmed on noveleffect.com/about-us/faq and keenresearch.com customer list), which provides Kaldi-based phoneme lattices and is marketed as supporting *"track reading progress word-by-word, detect insertions, deletions, and substitutions, measure reading pace and fluency."* So the actual implementation is: KeenASR produces a phoneme stream + alignment confidence → Novel Effect's patented logic does phoneme-edit-distance against pre-computed book phoneme data → triggers.
- All processing is on-device (per Novel Effect's privacy policy and FAQ: *"voice-recognition is performed on your device, no voice data is saved without express consent"*).

**Recommendation for YOUR app's robustness model:**

1. **Confidence-graded states.**
   - `TRACKING` (conf > 0.6): normal operation, full matcher, triggers fire.
   - `UNCERTAIN` (0.3 < conf ≤ 0.6): keep matcher running, widen lookahead from 120 to 250 tokens, raise trigger threshold by 20 %.
   - `LISTENING_FOR_NEXT_TRIGGER` (conf ≤ 0.3): stop advancing the cursor; run *only* phrase-specific spotters against the next 3-5 armed triggers using their full phrases. As soon as one fires, snap cursor to its position and bump confidence to 0.7. This is the "what would Novel Effect call its hold state" mode.
   - `LOST` (10+ s with no advance in `LISTENING_FOR_NEXT_TRIGGER`): show a subtle "tap to set position" UI affordance.

2. **Slow-decay, not freeze.** Don't stop the cursor; let it drift forward at ~1 word/second based on average reading pace once confidence drops, capped at +30 words. This means ambient sound transitions still happen roughly on time even if specific triggers are missed.

3. **Manual recovery: a small "I'm on this page" tap.** Novel Effect avoids any in-reading interaction — and this is precisely why users get frustrated when it desyncs ("you may get the same sound effect for 3-5 pages"). Differentiate by adding a single discreet recovery affordance: a thin always-on "page picker" strip at the bottom that the parent can tap to jump the cursor. **One-tap recovery is the killer feature reviewers will praise.**

4. **Ambient music should be cursor-region-driven, not trigger-driven.** Bind ambient music to *book regions* (chapter / page) and crossfade based on cursor position. If the cursor is stuck, the ambient bed naturally holds — but it should fade out after 30 s of no cursor movement, not loop forever (the Novel Effect failure).

**Comparable systems.**

- **Karaoke (Smule, Yousician):** they have it easier — fixed-tempo backing track gives them a strong prior. Smule uses time-domain pitch tracking + pre-aligned lyric timings; alignment is mostly playback-position with vocal scoring on top. Not a model for read-aloud.
- **Yousician (instruments):** pYIN pitch detection + DTW against expected pitch sequence with a moving frame. The DTW + monotonic-warp pattern is directly applicable.
- **Audible Whispersync for Voice / Kindle Immersion Reading:** uses *precomputed* forced alignment of professional narration to ebook text + simple playback-position lookup. Doesn't help you because there's no live ASR.
- **Epic / Speakaboos:** pre-recorded narration; not live tracking.
- **Apple Bookstats / Reading Coach (Microsoft):** uses on-device ASR + word-level scoring (similar to KeenASR's "reading assessment" mode). Closer to what you want.

**Worth investigating:** Novel Effect patents US 10,249,205 (parent), US 11,501,769, US 11,526,671, US 12,315,533 (all assigned to Novel Effect, Inc., inventor Matthew Hammersley); KeenASR documentation including their reading-assessment APIs; the Whispersync for Voice patents (Amazon); Microsoft's "Reading Coach" / "Reading Progress" technical blog posts (Microsoft Research). Audio fingerprinting (Wang / Shazam, dejavu) is *not* what Novel Effect uses despite some speculation — they're explicit about phoneme edit distance.

## Recommended Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  JS / React (UI, session lifecycle, telemetry, manual recovery)  │
│   - session start: load book text, triggers; init native modules │
│   - UI: progress strip, "I'm on this page" tap, error toasts     │
│   - Receives: { cursor, confidence, state, lastTriggerFired }    │
└──────────────────────────────────────────────────────────────────┘
                       ▲ throttled events (10 Hz)
                       │
┌──────────────────────────────────────────────────────────────────┐
│  Native module: SessionEngine (Swift + Kotlin, ~600 LOC each)    │
│   - Owns cursor, confidence, trigger priority queue              │
│   - Smith-Waterman matcher (~50 LOC native)                      │
│   - Phrase spotter for armed triggers (~30 LOC)                  │
│   - State machine: TRACKING / UNCERTAIN / LISTENING / LOST       │
│   - Calls AudioPool.playOneShot(id) synchronously                │
└──────────────────────────────────────────────────────────────────┘
        ▲ partial hypothesis (~3-5 Hz)             │ play(id)
        │                                          ▼
┌────────────────────────────┐         ┌───────────────────────────┐
│ whisper.rn RealtimeTrans-  │         │ AudioPool (native)        │
│  - PCM stream @ 16 kHz     │         │  - iOS: AVAudioPlayer pool│
│  - Silero VAD              │         │  - Android: SoundPool +   │
│  - tiny.en + Core ML enc.  │         │    MediaPlayer for ambient│
│  - 1.5 s sliding window    │         │  - preloaded at session   │
│  - VAD-end-triggered decode│         │    start                  │
└────────────────────────────┘         └───────────────────────────┘
        ▲                                          ▲
        │ PCM frames @ 16 kHz                      │ ambient bed
        │                                          │ control
┌──────────────────────────────────────────────────────────────────┐
│  @fugood/react-native-audio-pcm-stream  +  AVAudioSession        │
│    category: playAndRecord, mode: measurement, ducks others      │
└──────────────────────────────────────────────────────────────────┘
```

**Cadences.**
- Microphone PCM: 16 kHz continuous, 20-ms native frames.
- Silero VAD: per 30-ms frame native (~30 Hz).
- Whisper inference: triggered by VAD-end OR every 1.5 s, whichever first (~1-3 Hz typical).
- Matcher (Smith-Waterman over ring buffer × book window): on every whisper partial (~2-5 Hz).
- Trigger eligibility check: same cadence as matcher; armed triggers also get a cheap phrase-spotter check at ~5 Hz.
- JS bridge events: throttled to 10 Hz (cursor, confidence, state); fire-trigger event sent immediately when a trigger fires.

**Data structures (native side).**
- `book.tokens: Token[]` (immutable; ~5-30 K entries; each Token has `{ surface, normalized, metaphone1, metaphone2 }`).
- `triggers: MinHeap<Trigger>` ordered by `wordIndex`; first N armed at any time.
- `triggers.done: Set<TriggerId>`.
- `recentTokens: RingBuffer<Token>` capacity 40.
- `cursor: AtomicInt`, `confidence: AtomicFloat`.
- `audioPool: Map<TriggerId, NativePlayer>` preloaded at start.

**JS / native split.**
- JS: UI, navigation, content download, analytics, session config. Reads cursor/state events; can call `pause()`, `resume()`, `setCursor(wordIdx)` for manual recovery.
- Native: everything in the audio→cursor→trigger→playback hot path. The JS thread is never on a critical-latency path.

### The single biggest technical risk to spike first

**Kill-or-validate spike (build this in week 1, nothing else):**

Build the simplest possible end-to-end vertical slice:
1. Bare RN app with `whisper.rn` `RealtimeTranscriber` + `tiny.en-q5_1` + Silero VAD.
2. A hard-coded 200-word book text and 3 trigger phrases at known positions.
3. A naive JS-side substring match over the rolling whisper output.
4. `react-native-sound` playing 3 prerecorded MP3s.
5. **Stopwatch on a real iPhone 12 / iPhone SE (2020) AND a real Pixel 6 / Galaxy A52 — not a flagship, not a simulator.**

**Measure**: from when each test phrase finishes being spoken (use a clap or a chirp at the end) to when the trigger sound's first sample emits. Want p50 < 800 ms and p95 < 1.5 s on both devices. Run 30 trials per phrase.

If you can hit that with this naïve setup, the rest of the architecture is just engineering polish — the matcher will only make things *better*, not worse. If you can't hit it on Android, you must either (a) drop to `expo-speech-recognition` with all its restart fragility, (b) license KeenASR (Novel Effect's actual engine, optimized for this exact use case), or (c) build/use a sherpa-onnx-based custom Whisper-tiny pipeline that has been measured at 51× whisper.cpp on Android per VoicePing's February 2026 benchmark. All three of those are weeks of work; you want to know in week 1.

The matcher, the trigger queue, the audio pool — all of that is conventional engineering. **Latency is the only unknown.** Spike it first.

## Recommendations

**Immediate (week 1):**
1. Build the latency spike described above. Decision criterion: p95 end-to-end < 1.5 s on a Pixel 6.
2. Do NOT spend time on the matcher, manual recovery UI, or polish until the spike passes.

**If the spike passes (weeks 2-4):**
1. Move the trigger queue, ring buffer, and Smith-Waterman matcher to a native module (Swift + Kotlin). Wire via Nitro modules / TurboModules — not the legacy bridge.
2. Build the AudioPool native module (AVAudioPlayer pool + SoundPool). Two days.
3. Implement the confidence state machine and the "I'm on this page" tap UI.
4. Add Double Metaphone phonetic backoff to token comparisons.

**If the spike fails on Android specifically:**
1. Evaluate sherpa-onnx with Whisper-tiny ONNX — the 51× claim from VoicePing's February 2026 benchmark is the only credible path to keeping a unified pipeline.
2. If sherpa-onnx also fails, ship Android with `expo-speech-recognition` + auto-restart, and bite the bullet on the 10-second-silence gaps. Cover the gaps with the "slow-drift cursor" Q5 logic so the experience degrades gracefully.

**v2 / longer term:**
1. Move from token-edit-distance to **phoneme edit distance** following Novel Effect's patent approach. Vosk gives you phoneme-level Kaldi output; pair with grapheme-to-phoneme on the book text using `cmudict` (free, ~125 K words covers >99 % of children's books). This is the durable answer and what makes the difference between "works on adults reading clearly" and "works on a 5-year-old reading to a sibling."
2. License inquiry with Keen Research. If their pricing for a consumer app is reasonable, KeenASR is the literal proven engine for this task.

**Benchmarks that change the recommendation:**
- If measured p95 end-to-end on Pixel 6 > 1.5 s with whisper-tiny → switch primary to sherpa-onnx or platform-native ASR.
- If WER on a corpus of 50 child-reader samples > 25 % → tiny.en is too small; move to base.en if device class supports it.
- If trigger false-fire rate > 3 % per session in beta → tighten match threshold by 0.05 increments; if still failing, ship phoneme matching v2.
- If beta sessions show >10 % of sessions hitting `LOST` state → manual recovery UI is mandatory; expand from "tap to set page" to "tap a sentence."

## Caveats

- **Patents.** Novel Effect's family (US 10,249,205, 11,501,769, 11,526,671, 12,315,533) covers phoneme-edit-distance approaches and threshold-based off-script detection. A pure speech-to-text + token-Smith-Waterman approach (the v1 recommendation above) is meaningfully different from their claimed inventions, but you should have IP counsel read US 11,526,671 carefully — claim 1's full text was not retrievable through public mirrors and may be broader than the dependent claims I have verbatim. Their `comparing the audio data and the text source` (claim 1, US 11,526,671) language could be read broadly. Plan budget for a freedom-to-operate review before public launch.
- **Whisper hallucinations.** Whisper-tiny is notorious for generating plausible-but-wrong continuations on background music or silence. The Silero VAD gate is the single most important mitigation. Test specifically with music playing through the phone's speakers during silence — this is your worst-case input.
- **Children's voices.** Whisper was trained heavily on adult speech; WER on 4-7 year olds can be 2-3× the adult rate. Your test corpus must include child readers. KeenASR markets itself as "optimized for kids' voices" — there's no equivalent in the free OSS world. The fuzzy matcher absorbs some of this; the phoneme-v2 approach absorbs more.
- **Numbers above are design budgets, not measured values for your exact device + model combination.** The whisper.cpp benchmark thread (issue #89) has data for iPhone 13 Mini base encoder = 1091 ms per 30 s clip, but no published tiny.en data for iPhone 12 / Pixel 6 specifically. You will measure your own numbers in the spike.
- **Expo + custom native modules.** Whisper.rn, react-native-sound (modern fork), and any Nitro modules require EAS prebuild / custom dev client. You will not be able to use Expo Go. This is universally true for any production-quality audio app and is not a deal-breaker, but plan for the 30-minute build cycle.
- **Battery and thermal.** A 20-minute reading session with continuous whisper inference will warm the phone noticeably. iPhone 12-class with Core ML: tolerable. Pixel 6 CPU: noticeable warmth. Lower-end Android (Snapdragon 6-series): may thermal-throttle after 10 minutes and degrade RTF. Have an "Eco mode" toggle that uses `tiny.en-q5_1` instead of base.en and widens VAD silence threshold.
- **The Novel Effect freeze symptom is structural, not lazy engineering.** Their patent claims that thresholded-correspondence-with-hold IS the algorithm. Your one-tap recovery is the differentiator; without it you'll get the same reviews.