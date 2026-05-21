Strong alignment on ~80% of the architecture. There are four genuine disagreements worth flagging, and one of them is a direct factual contradiction where the evidence favors one side.
Where we agree (and you can act on this now)

react-native-voice is out. They note it's archived as of January 2026; I noted the silence-cutoff and partial-clearing failures. Same conclusion either way.
Forward-only monotonic matcher over a sliding window of the known book text. Both reports converge on this. Their two-stage version (n-gram candidate generator → DP alignment) and my Smith-Waterman are the same idea at slightly different abstraction levels.
Armed-trigger corridors keyed off the cursor, with single-word vs multi-word phrases handled differently. Almost identical state machines.
Per-trigger cooldown (~1.5s) and "nearest-armed-pending wins" for repeated phrases like "goodnight" ×12.
VAD-gated decoding is mandatory.
Manual recovery UI is mandatory, even if you hope nobody uses it.
Don't use expo-av — it's deprecated.
Spike the riskiest unknown first before building anything else.

Where we genuinely disagree

1. Primary ASR engine. They recommend Sherpa-ONNX as production target with expo-speech-recognition as the prototype harness. I recommend whisper.rn (tiny.en) as primary. Both are defensible. Sherpa-ONNX has true native streaming primitives that whisper lacks, and the VoicePing benchmark I cited actually supports their view that sherpa-onnx is meaningfully faster than whisper.cpp on Android. Whisper.rn has a more mature RN ecosystem and a documented RealtimeTranscriber API today. Honest read: their pick is probably the better long-term production target; mine is the faster path to a working prototype. The right move is to measure both in the spike and decide on data.
2. Audio playback — this is the one direct factual contradiction. They recommend expo-audio with preloading. I explicitly recommend against it, citing Expo's own GitHub issue #42900 where the verbatim conclusion is that expo-audio "doesnt fits for sound effects." That issue is real, current, and the maintainer-acknowledged gap is that downloadFirst only downloads — it does not keep a decoded buffer hot. I think the evidence favors my side here. For trigger fires specifically (not ambient music), use react-native-sound or a small Nitro module wrapping SoundPool/AVAudioPlayer. Use expo-audio for the ambient bed only. Test both in the spike with a stopwatch — if expo-audio actually delivers sub-50ms first-play, great, use it.
3. Low-confidence behavior. They say hard-freeze the cursor; I proposed a slow-drift fallback. On reflection their position is safer — CMU's reading-tutor work specifically shows that false-correction erodes user trust, and slow-drift could silently arm stale triggers. The right synthesis: hard-freeze the cursor and trigger eligibility, but allow ambient music to crossfade on a timer independent of the cursor.
4. Novel Effect analysis. They noted the patent exists but didn't extract its architecture. I dug into US 11,526,671 and US 12,315,533 and found that Novel Effect deliberately does NOT do speech-to-text — they compute phoneme edit distance directly on audio via KeenASR. This matters because their "freezes for 3-5 pages" failure mode is the explicit fallback in their patent, not a bug. The implication: a phoneme-distance v2 architecture is the durable long-term answer, and a one-tap manual recovery is the competitive differentiator since they refuse to add one.
   Unanimous plan, going forward

Week 1 spike — Build the minimum end-to-end vertical slice on a real mid-range Android device. Measure two things: (a) p95 end-to-end latency from end-of-phrase to first audible sample, target <1.5s; (b) recognizer stability over a continuous 15-minute read with realistic pauses and child interruptions. Both reports identify these as the kill-or-validate questions. Test whisper.rn AND sherpa-onnx in this spike — the choice between them is the one architectural decision worth data, not opinion. Also test expo-audio vs react-native-sound first-play latency directly.
If the spike passes, build the matcher and trigger queue natively (both reports agree), with hard-freeze + manual recovery for low-confidence states (their position; correct).
V2 moves toward phoneme-distance matching following Novel Effect's patent insight (my finding), which is the architectural moat against the freeze problem.

The 80% we agree on is the architecture. The 20% we disagree on is two empirical questions (which ASR, which audio API) and one philosophical one (what to do when lost) where their answer is better than mine. Treat the empirical questions as spike outputs, not pre-decisions.
