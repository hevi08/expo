import { SyntheticPlatformEmitter } from '@unimodules/core';
import { PermissionResponse, PermissionStatus } from 'expo-modules-core';

import { AVPlaybackNativeSource, AVPlaybackStatus, AVPlaybackStatusToSet } from './AV';
import { RecordingStatus, RECORDING_OPTIONS_PRESET_HIGH_QUALITY } from './Audio/Recording';

async function getPermissionWithQueryAsync(name: PermissionName): Promise<PermissionStatus | null> {
  if (!navigator || !navigator.permissions || !navigator.permissions.query) return null;

  try {
    const { state } = await navigator.permissions.query({ name });
    switch (state) {
      case 'granted':
        return PermissionStatus.GRANTED;
      case 'denied':
        return PermissionStatus.DENIED;
      default:
        return PermissionStatus.UNDETERMINED;
    }
  } catch (error) {
    // FireFox - TypeError: 'microphone' (value of 'name' member of PermissionDescriptor) is not a valid value for enumeration PermissionName.
    return PermissionStatus.UNDETERMINED;
  }
}

function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  // Some browsers partially implement mediaDevices. We can't just assign an object
  // with getUserMedia as it would overwrite existing properties.
  // Here, we will just add the getUserMedia property if it's missing.

  // First get ahold of the legacy getUserMedia, if present
  const getUserMedia =
    navigator.getUserMedia ||
    (navigator as any).webkitGetUserMedia ||
    (navigator as any).mozGetUserMedia ||
    function() {
      const error: any = new Error('Permission unimplemented');
      error.code = 0;
      error.name = 'NotAllowedError';
      throw error;
    };

  return new Promise((resolve, reject) => {
    getUserMedia.call(navigator, constraints, resolve, reject);
  });
}

function getStatusFromMedia(media?: HTMLMediaElement): AVPlaybackStatus {
  if (!media) {
    return {
      isLoaded: false,
      error: undefined,
    };
  }

  const isPlaying = !!(
    media.currentTime > 0 &&
    !media.paused &&
    !media.ended &&
    media.readyState > 2
  );

  const status: AVPlaybackStatus = {
    isLoaded: true,
    uri: media.src,
    progressUpdateIntervalMillis: 100, //TODO: Bacon: Add interval between calls
    durationMillis: media.duration * 1000,
    positionMillis: media.currentTime * 1000,
    // playableDurationMillis: media.buffered * 1000,
    // seekMillisToleranceBefore?: number
    // seekMillisToleranceAfter?: number
    shouldPlay: media.autoplay,
    isPlaying,
    isBuffering: false, //media.waiting,
    rate: media.playbackRate,
    // TODO: Bacon: This seems too complicated right now: https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-frequency
    shouldCorrectPitch: false,
    volume: media.volume,
    isMuted: media.muted,
    isLooping: media.loop,
    didJustFinish: media.ended,
  };

  return status;
}

function setStatusForMedia(
  media: HTMLMediaElement,
  status: AVPlaybackStatusToSet
): AVPlaybackStatus {
  if (status.positionMillis !== undefined) {
    media.currentTime = status.positionMillis / 1000;
  }
  // if (status.progressUpdateIntervalMillis !== undefined) {
  //   media.progressUpdateIntervalMillis = status.progressUpdateIntervalMillis;
  // }
  // if (status.seekMillisToleranceBefore !== undefined) {
  //   media.seekMillisToleranceBefore = status.seekMillisToleranceBefore;
  // }
  // if (status.seekMillisToleranceAfter !== undefined) {
  //   media.seekMillisToleranceAfter = status.seekMillisToleranceAfter;
  // }
  // if (status.shouldCorrectPitch !== undefined) {
  //   media.shouldCorrectPitch = status.shouldCorrectPitch;
  // }
  if (status.shouldPlay !== undefined) {
    if (status.shouldPlay) {
      media.play();
    } else {
      media.pause();
    }
  }
  if (status.rate !== undefined) {
    media.playbackRate = status.rate;
  }
  if (status.volume !== undefined) {
    media.volume = status.volume;
  }
  if (status.isMuted !== undefined) {
    media.muted = status.isMuted;
  }
  if (status.isLooping !== undefined) {
    media.loop = status.isLooping;
  }

  return getStatusFromMedia(media);
}

let mediaRecorder: null | any /*MediaRecorder*/ = null;
let mediaRecorderUptimeOfLastStartResume: number = 0;
let mediaRecorderDurationAlreadyRecorded: number = 0;
let mediaRecorderIsRecording: boolean = false;

function getAudioRecorderDurationMillis() {
  let duration = mediaRecorderDurationAlreadyRecorded;
  if (mediaRecorderIsRecording && mediaRecorderUptimeOfLastStartResume > 0) {
    duration += Date.now() - mediaRecorderUptimeOfLastStartResume;
  }
  return duration;
}

export default {
  get name(): string {
    return 'ExponentAV';
  },
  async getStatusForVideo(element: HTMLMediaElement): Promise<AVPlaybackStatus> {
    return getStatusFromMedia(element);
  },
  async loadForVideo(
    element: HTMLMediaElement,
    nativeSource: AVPlaybackNativeSource,
    fullInitialStatus: AVPlaybackStatusToSet
  ): Promise<AVPlaybackStatus> {
    return getStatusFromMedia(element);
  },
  async unloadForVideo(element: HTMLMediaElement): Promise<AVPlaybackStatus> {
    return getStatusFromMedia(element);
  },
  async setStatusForVideo(
    element: HTMLMediaElement,
    status: AVPlaybackStatusToSet
  ): Promise<AVPlaybackStatus> {
    return setStatusForMedia(element, status);
  },
  async replayVideo(
    element: HTMLMediaElement,
    status: AVPlaybackStatusToSet
  ): Promise<AVPlaybackStatus> {
    return setStatusForMedia(element, status);
  },
  /* Audio */
  async setAudioMode() {},
  async setAudioIsEnabled() {},
  async getStatusForSound(element: HTMLMediaElement) {
    return getStatusFromMedia(element);
  },
  async loadForSound(
    nativeSource: string | { uri: string; [key: string]: any },
    fullInitialStatus: AVPlaybackStatusToSet
  ): Promise<[HTMLMediaElement, AVPlaybackStatus]> {
    const source = typeof nativeSource === 'string' ? nativeSource : nativeSource.uri;
    const media = new Audio(source);

    media.ontimeupdate = () => {
      SyntheticPlatformEmitter.emit('didUpdatePlaybackStatus', {
        key: media,
        status: getStatusFromMedia(media),
      });
    };

    media.onerror = () => {
      SyntheticPlatformEmitter.emit('ExponentAV.onError', {
        key: media,
        error: media.error!.message,
      });
    };

    const status = setStatusForMedia(media, fullInitialStatus);

    return [media, status];
  },
  async unloadForSound(element: HTMLMediaElement) {
    element.pause();
    element.removeAttribute('src');
    element.load();
    return getStatusFromMedia(element);
  },
  async setStatusForSound(
    element: HTMLMediaElement,
    status: AVPlaybackStatusToSet
  ): Promise<AVPlaybackStatus> {
    return setStatusForMedia(element, status);
  },
  async replaySound(
    element: HTMLMediaElement,
    status: AVPlaybackStatusToSet
  ): Promise<AVPlaybackStatus> {
    return setStatusForMedia(element, status);
  },

  /* Recording */
  //   async setUnloadedCallbackForAndroidRecording() {},
  async getAudioRecordingStatus(): Promise<RecordingStatus> {
    return {
      canRecord: mediaRecorder?.state === 'recording' || mediaRecorder?.state === 'inactive',
      isRecording: mediaRecorder?.state === 'recording',
      isDoneRecording: false,
      durationMillis: getAudioRecorderDurationMillis(),
      uri: null,
    };
  },
  async prepareAudioRecorder(
    options
  ): Promise<{
    uri: string | null;
    // status is of type RecordingStatus, but without the canRecord field populated
    status: Pick<RecordingStatus, Exclude<keyof RecordingStatus, 'canRecord'>>;
  }> {
    if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
      throw new Error('No media devices available');
    }

    mediaRecorderUptimeOfLastStartResume = 0;
    mediaRecorderDurationAlreadyRecorded = 0;

    const stream = await getUserMedia({ audio: true });

    mediaRecorder = new (window as any).MediaRecorder(
      stream,
      options?.web || RECORDING_OPTIONS_PRESET_HIGH_QUALITY.web
    );

    mediaRecorder.addEventListener('pause', () => {
      mediaRecorderDurationAlreadyRecorded = getAudioRecorderDurationMillis();
      mediaRecorderIsRecording = false;
    });

    mediaRecorder.addEventListener('resume', () => {
      mediaRecorderUptimeOfLastStartResume = Date.now();
      mediaRecorderIsRecording = true;
    });

    mediaRecorder.addEventListener('start', () => {
      mediaRecorderUptimeOfLastStartResume = Date.now();
      mediaRecorderDurationAlreadyRecorded = 0;
      mediaRecorderIsRecording = true;
    });

    mediaRecorder.addEventListener('stop', () => {
      mediaRecorderDurationAlreadyRecorded = getAudioRecorderDurationMillis();
      mediaRecorderIsRecording = false;

      // Clears recording icon in Chrome tab
      stream.getTracks().forEach(track => track.stop());
    });

    const { uri, ...status } = await this.getAudioRecordingStatus();

    return { uri: null, status };
  },
  async startAudioRecording(): Promise<RecordingStatus> {
    if (mediaRecorder === null) {
      throw new Error(
        'Cannot start an audio recording without initializing a MediaRecorder. Run prepareToRecordAsync() before attempting to start an audio recording.'
      );
    }

    if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
    } else {
      mediaRecorder.start();
    }

    return this.getAudioRecordingStatus();
  },
  async pauseAudioRecording(): Promise<RecordingStatus> {
    if (mediaRecorder === null) {
      throw new Error(
        'Cannot start an audio recording without initializing a MediaRecorder. Run prepareToRecordAsync() before attempting to start an audio recording.'
      );
    }

    // Set status to paused
    mediaRecorder.pause();

    return this.getAudioRecordingStatus();
  },
  async stopAudioRecording(): Promise<RecordingStatus> {
    if (mediaRecorder === null) {
      throw new Error(
        'Cannot start an audio recording without initializing a MediaRecorder. Run prepareToRecordAsync() before attempting to start an audio recording.'
      );
    }

    if (mediaRecorder.state === 'inactive') {
      return this.getAudioRecordingStatus();
    }

    const dataPromise = new Promise(resolve =>
      mediaRecorder.addEventListener('dataavailable', e => resolve(e.data))
    );

    mediaRecorder.stop();

    const data = await dataPromise;
    const url = URL.createObjectURL(data);

    return {
      ...(await this.getAudioRecordingStatus()),
      uri: url,
    };
  },
  async unloadAudioRecorder(): Promise<void> {
    mediaRecorder = null;
  },

  async getPermissionsAsync(): Promise<PermissionResponse> {
    const maybeStatus = await getPermissionWithQueryAsync('microphone');
    switch (maybeStatus) {
      case PermissionStatus.GRANTED:
        return {
          status: PermissionStatus.GRANTED,
          expires: 'never',
          canAskAgain: true,
          granted: true,
        };
      case PermissionStatus.DENIED:
        return {
          status: PermissionStatus.DENIED,
          expires: 'never',
          canAskAgain: true,
          granted: false,
        };
      default:
        return await this.requestPermissionsAsync();
    }
  },
  async requestPermissionsAsync(): Promise<PermissionResponse> {
    try {
      const stream = await getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return {
        status: PermissionStatus.GRANTED,
        expires: 'never',
        canAskAgain: true,
        granted: true,
      };
    } catch (e) {
      return {
        status: PermissionStatus.DENIED,
        expires: 'never',
        canAskAgain: true,
        granted: false,
      };
    }
  },
};
