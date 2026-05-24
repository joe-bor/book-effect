const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const whisperRnRoot = path.join(__dirname, 'node_modules/whisper.rn');
const whisperRnResolution = {
  'whisper.rn': path.join(whisperRnRoot, 'lib/module/index.js'),
  'whisper.rn/realtime-transcription': path.join(
    whisperRnRoot,
    'lib/module/realtime-transcription/index.js',
  ),
  'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter': path.join(
    whisperRnRoot,
    'lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter.js',
  ),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const whisperRnPath = whisperRnResolution[moduleName];

  if (whisperRnPath !== undefined) {
    return {
      type: 'sourceFile',
      filePath: whisperRnPath,
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
