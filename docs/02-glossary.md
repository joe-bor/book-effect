# Glossary

## ASR

Automatic speech recognition. The component that turns microphone audio into text hypotheses.

## Partial Hypothesis

An interim ASR result that may still change. Partials are useful for low latency, but they can be unstable.

## Final Hypothesis

An ASR result the recognizer considers complete for a segment. Finals are usually more stable than partials, but waiting for them can make sound effects late.

## Cursor

The app's current best word-index position in the book. The cursor is forward-only during a session; it never moves backward automatically.

## Word Index

The zero-based position of a normalized word token in the book text. Triggers are keyed to word indices.

## Trigger

A planned sound effect tied to a phrase and expected book position: `{ phrase, wordIndex, sound, type }`.

## Pending

A trigger that has not yet become eligible.

## Armed

A trigger whose word index is close enough to the cursor that the app should listen for its phrase.

## Fired

A trigger whose sound has already played. Each trigger fires at most once per session.

## Expired

A trigger that was armed but did not match before the cursor moved too far past it. Expired triggers fail silently.

## Corridor

The word-index range where a trigger or cursor match is allowed. Corridors keep repeated phrases from matching the wrong occurrence.

## Ring Buffer

A fixed-size buffer of recent ASR tokens or events. Old entries drop off automatically as new entries arrive.

## Matcher

The logic that aligns recent ASR text to the known book text and advances the cursor.

## Smith-Waterman

A local alignment algorithm originally used in bioinformatics. Here it means scoring a short ASR token sequence against a nearby book-token window to find the best local match.

## Phonetic Backoff

Matching words by approximate sound when exact text differs, such as `road` and `rode`. This is a v1 or v2 robustness tool, not part of the spike.

## VAD

Voice activity detection. It decides when speech starts and ends so the recognizer does not waste work on silence.

## RTF

Real-time factor. An ASR speed metric: `processing time / audio duration`. RTF below 1.0 means faster than real time.

## WER

Word error rate. An ASR accuracy metric based on substitutions, insertions, and deletions compared with expected text.

## Hard-Freeze

A low-confidence behavior where the app stops advancing the public cursor and stops arming new triggers rather than guessing.

## Reacquisition

The process of finding the reader's position again after confidence drops. This may use a wider search corridor or manual recovery.

## Manual Recovery

A hidden tap or control that lets the reader set the app near the current page or position when automatic tracking is lost.

## Trigger Cooldown

A short period after a trigger fires where the same trigger cannot fire again. This is defense in depth; fired triggers are also permanently done for the session.

## Ambient Bed

Background music or ambience that may play across a book region. It is separate from one-shot trigger sounds and should not depend on stale trigger eligibility.
