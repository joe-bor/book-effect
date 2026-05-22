# Sherpa-ONNX Provider Status

The Phase 1 spike needs to compare Sherpa-ONNX against `whisper.rn` on the Galaxy S10.

Current finding:

- `sherpa-onnx` is available on npm.
- `sherpa-onnx-react-native` was not found in the npm registry during Task 2.
- The current React Native wrapper appears to be `react-native-sherpa-onnx`, which is available on npm and points to `XDcobra/react-native-sherpa-onnx`.
- `react-native-sherpa-onnx` has been installed in the spike app as the Sherpa integration candidate.

Decision needed before implementation:

- Validate `react-native-sherpa-onnx` against the spike's Expo prebuild/custom dev client flow.
- Choose a small streaming STT model that can run on the Galaxy S10.
- Only build a custom bridge if the installed wrapper fails the spike integration check.
