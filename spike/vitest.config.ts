import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'whisper.rn': './node_modules/whisper.rn/lib/module/index.js',
      'whisper.rn/realtime-transcription':
        './node_modules/whisper.rn/lib/module/realtime-transcription/index.js',
      'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter':
        './node_modules/whisper.rn/lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter.js',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
