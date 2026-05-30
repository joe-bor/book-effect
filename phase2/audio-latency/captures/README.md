# P6 captures — Galaxy S10 (SM-G973U), May 29, 2026

Raw acoustic self-capture data behind [docs/09-audio-latency-results.md](../../../docs/09-audio-latency-results.md).
Each run is the probe log (`.json`: fires + clock samples) and the device mic recording
(`.m4a`, 44.1 kHz mono AAC). `.summary.json` is the analyzer output.

| Run | Reps/lib | expo-audio | react-native-sound |
| --- | --- | --- | --- |
| `run1-32reps` | 32 | 32/32, p50 197 ms | 20/32 (12 dropped), p50 179 ms |
| `run2-56reps` | 56 | 56/56, p50 237 ms | 33/56 (23 dropped), p50 215 ms |

Re-analyze:

```bash
cd phase2/audio-latency
../matcher-lab/node_modules/.bin/tsx ./analyze.ts captures/run2-56reps.json captures/run2-56reps.m4a
```
