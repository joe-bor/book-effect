# Book Effect v1 Device Protocols

## S10 Setup

- Device: Galaxy S10 `SM-G973U`.
- Use USB. Do not spend validation time on wireless adb.
- Before launching a dev build:

```bash
adb reverse tcp:8081 tcp:8081
npm run android
```

## Log Pull

```bash
adb shell run-as com.joebor.bookeffect ls -1 cache </dev/null
adb shell run-as com.joebor.bookeffect cat cache/<file> </dev/null > <local-file>
adb exec-out run-as com.joebor.bookeffect cat cache/<binary-file> </dev/null > <local-binary-file>
```

## Acceptance Read-Through

- Confirm the acceptance book appears in the library.
- Confirm all acceptance-book sounds preload.
- Confirm mic permission can be granted.
- Start the session with the phone nearby and screen awake.
- Read naturally from the physical book.
- Use hidden tap recovery only when the app clearly loses place or freezes.
- Capture dev log and human notes for missed, late, wrong, freeze/recovery, hidden-tap, overlap, and lifecycle observations.

## S10 Production Engine Cost

- Enable dev logging of every `SessionTracker.process()` duration.
- Capture p50, p95, max, and sample count from the dev log.
- Investigate if p95 threatens the 200 ms frame budget.

## 15-20 Minute Battery, Thermal, Stability Run

- Start plugged in for dev-build asset preload.
- Unplug for the measurement window.
- Replug and re-add `adb reverse tcp:8081 tcp:8081` before pulling logs.
- Capture battery and thermal readings before and after.

## Native Audio Acoustic Latency

- Preload a short click/effect.
- Log immediately before `play()`.
- Record acoustic output.
- Analyze command to first audible sample.

## iPhone 12 Follow-On

- Not a v1 gate.
- Run the same native audio contract and acoustic protocol once device access exists.

## Offline Regression Notes

- `npm run regression:phase2:human` runs the non-mutating Phase 2 human replay reference and parses its summary.
- The parsed Phase 2 numbers are regression/reference alarms, not formal sign-off gates.
- `npm --prefix phase2/matcher-lab run replay` writes generated `BASELINE.md` and `FUZZY.md` reports and must only be run intentionally with a diff review.
