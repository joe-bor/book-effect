# Book Effect Spike

This is the Phase 1 throwaway measurement app for Book Effect. It exists to build a native Expo development runtime, open the spike UI on real devices, and later collect latency/stability data. Expo Go is not expected to work because the spike uses native ASR and audio libraries.

Do not use this app as v1 product code.

## Prerequisites

- Node from `spike/.nvmrc`: `v22.22.1`.
- npm compatible with Node 22.
- Android Studio with SDK Platform Tools installed.
- A physical Android device with Developer Options and USB debugging enabled, or a configured Android emulator.
- Full Xcode installed for iOS builds.
- CocoaPods installed for iOS native dependencies.

From `spike/`, start each Expo or npm command session with:

```bash
nvm use
```

If the shell still resolves the wrong Node inside `spike/`, prefix commands with the pinned Node path:

```bash
env PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH" npm run typecheck
```

## Install

```bash
cd spike
npm install
```

## Native Prebuild

Generate native projects before local device builds:

```bash
cd spike
npx expo prebuild
```

`expo prebuild` creates `android/` and `ios/` directories. Treat those as generated native output for the Phase 1 spike unless a future task intentionally moves to committed native projects. Review any generated files carefully before adding them to git.

## Android Device Run

1. On the Android device, enable Developer Options.
2. Enable USB debugging.
3. Connect the device by USB.
4. Accept the RSA debugging prompt on the device.
5. Confirm the device is visible:

```bash
adb devices
```

Expected output includes one attached device with `device` status. If the list is empty, the local build cannot install or open the app on Android yet.

Build, install, and launch the native Android debug app:

```bash
cd spike
npm run android
```

This uses `expo run:android`, which creates a local native debug build and starts Metro. Re-run it after changing native dependencies or Expo config. For JavaScript-only changes after a successful install, `npm run start` can serve the app to the installed development build.

## iOS Device Run

Before running on a physical iPhone:

1. Install and open full Xcode once.
2. Accept licenses and install additional components.
3. Sign in to Xcode with the Apple ID used for personal-device signing.
4. Connect the iPhone by USB, trust the Mac, and enable Developer Mode if iOS prompts for it.

Build, install, and launch the native iOS debug app:

```bash
cd spike
npm run ios
```

This uses `expo run:ios`, which creates a local native debug build and starts Metro. If signing or device trust is blocked, resolve that in Xcode before expecting the CLI install to succeed.

## Development Build Expectation

Use the local native debug/development build path above, not Expo Go. The installed app has the native modules needed by the spike; Expo Go does not include this project's ASR and audio native dependencies.

The package `npm run start` script runs `expo start --dev-client`, so it expects an installed development build/dev-client style runtime.

After the first successful native install, use:

```bash
cd spike
npm run start
```

Then open the already-installed app on the device. Rebuild with `npm run android` or `npm run ios` whenever native dependencies, native config, or generated native code changes.

## Task 12 Local Build Notes

Last checked: May 24, 2026.

- Android: `npm run android` completed a native debug build, installed the app on a Galaxy S10 (`SM_G973U`) over wireless debugging, and opened the installed development build through Metro. After clearing Metro's cache with `npm run start -- --clear`, the spike UI rendered on the phone and manual sound trigger buttons played audio.
- iOS: full Xcode and CocoaPods are installed, and `npm run ios` reached native linking on an iOS simulator build. The build failed with duplicate RNFS symbols because both `react-native-fs@2.20.0` and `@dr.pogodin/react-native-fs@2.38.2` are linked as iOS Pods (`RNFS` and `ReactNativeFs`). This is recorded as a build blocker; no dependency changes were made in Task 12.
- App visibility: the spike was visible on the Galaxy S10. It did not open on iOS during this check.
