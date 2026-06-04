// Minimal little-endian PCM WAV reader (Int16 / Int32 / Float32), downmixed to mono.
// Used by the P6 audio-latency analyzer to read afconvert's decoded output. Built-ins only.

export type MonoSignal = {
  sampleRate: number;
  /** Mono samples in [-1, 1]. */
  samples: Float32Array;
  channels: number;
};

export function parseWav(buffer: Uint8Array): MonoSignal {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  if (readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let offset = 12;
  let format = 1; // 1 = PCM int, 3 = IEEE float
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const tag = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (tag === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (tag === "data") {
      dataStart = body;
      dataLength = size;
    }

    // Chunks are word-aligned (padded to even length).
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) {
    throw new Error("No data chunk found");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      const pos = dataStart + (frame * channels + ch) * bytesPerSample;
      sum += readSample(view, pos, bitsPerSample, format);
    }
    samples[frame] = sum / channels;
  }

  return { sampleRate, samples, channels };
}

function readSample(
  view: DataView,
  pos: number,
  bits: number,
  format: number,
): number {
  if (format === 3) {
    return bits === 64
      ? view.getFloat64(pos, true)
      : view.getFloat32(pos, true);
  }
  if (bits === 16) {
    return view.getInt16(pos, true) / 32768;
  }
  if (bits === 32) {
    return view.getInt32(pos, true) / 2147483648;
  }
  if (bits === 8) {
    // 8-bit PCM is unsigned, centered at 128.
    return (view.getUint8(pos) - 128) / 128;
  }
  if (bits === 24) {
    const b0 = view.getUint8(pos);
    const b1 = view.getUint8(pos + 1);
    const b2 = view.getUint8(pos + 2);
    let value = b0 | (b1 << 8) | (b2 << 16);
    if (value & 0x800000) {
      value -= 0x1000000;
    }
    return value / 8388608;
  }
  throw new Error(`Unsupported bit depth: ${bits}`);
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
