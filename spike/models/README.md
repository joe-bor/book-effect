# Whisper Model Files

Task 9 does not download or commit model binaries. Keep these files local-only for the spike.

Expected local files:

- `ggml-tiny.en.bin`: Whisper tiny English GGML model used by `whisper.rn`.
- `ggml-silero-v6.2.0.bin`: Silero VAD model used by `whisper.rn` realtime transcription.

Source notes:

- Whisper tiny English GGML models are published by the `whisper.cpp` project on Hugging Face under `ggerganov/whisper.cpp`.
- The `whisper.rn` README documents `ggml-tiny.en.bin` for tiny English and `ggml-silero-v6.2.0.bin` for VAD examples.
- Quantized tiny English variants such as `ggml-tiny.en-q5_1.bin` may be useful later, but the default Task 9 provider expects `ggml-tiny.en.bin` unless configured with another path.

Runtime placement:

- The provider defaults to the app document directory: `<DocumentDirectoryPath>/models/ggml-tiny.en.bin` and `<DocumentDirectoryPath>/models/ggml-silero-v6.2.0.bin`.
- A later UI or device-prep task can pass explicit `modelPath` and `vadModelPath` values if the files are copied somewhere else.
- For Android development builds, one practical local-only path is to push files into the debuggable app container with `adb`/`run-as` after the app is installed.

Do not commit `.bin`, `.gguf`, or `.mlmodelc` model artifacts unless the plan is updated and the user explicitly approves it.
