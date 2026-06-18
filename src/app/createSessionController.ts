import { PermissionsAndroid, Platform } from 'react-native';

import { contentAssets } from '../../content/compiled/assets';
import { SherpaAsrEngine } from '../asr/SherpaAsrEngine';
import { createAudioPlayer } from '../audio/AudioPlayer';
import { SessionTracker } from '../core/sessionTracker';
import type { Trigger } from '../core/types';
import { DevLogger } from '../devlog/DevLogger';
import { SessionController } from '../session/SessionController';
import type { AsrEngine, AudioPlayer, PermissionService } from '../session/types';

type CreateSessionControllerOptions = {
  asr?: AsrEngine;
  audio?: AudioPlayer;
  permissions?: PermissionService;
  assets?: Record<string, number>;
  log?: DevLogger;
  createTracker?: (tokens: readonly string[], triggers: readonly Trigger[]) => SessionTracker;
};

export function createSessionController(
  options: CreateSessionControllerOptions = {},
): SessionController {
  return new SessionController({
    asr: options.asr ?? new SherpaAsrEngine(),
    audio: options.audio ?? createAudioPlayer(),
    permissions: options.permissions ?? microphonePermissions,
    assets: options.assets ?? contentAssets,
    createTracker:
      options.createTracker ?? ((tokens, triggers) => new SessionTracker(tokens, triggers)),
    log: options.log ?? new DevLogger({ enabled: isDevRuntime(), capacity: 500 }),
  });
}

const microphonePermissions: PermissionService = {
  async requestMicrophone() {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  },
};

function isDevRuntime(): boolean {
  return process.env.NODE_ENV !== 'production';
}
