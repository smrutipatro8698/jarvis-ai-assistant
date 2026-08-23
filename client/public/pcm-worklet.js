// AudioWorklet processor: captures microphone audio, resamples it to 16 kHz
// mono, converts to signed 16-bit little-endian PCM, and posts fixed-size
// frames to the main thread. That PCM is what the cloud STT providers
// (Soniox / AssemblyAI) expect. Runs only in server STT mode; browser mode
// never loads this.
//
// The browser gives us audio at the AudioContext's native rate (usually
// 48 kHz) in 128-sample blocks. We linearly resample to 16 kHz, carrying a
// fractional read position across blocks so there are no gaps at boundaries.

const TARGET_RATE = 16000;
// ~64 ms of audio per posted frame (1024 samples @ 16 kHz) — a good balance of
// latency and per-message overhead.
const FRAME_SAMPLES = 1024;

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / TARGET_RATE; // e.g. 48000/16000 = 3
    this._pos = 0; // fractional read position into _buf
    this._buf = new Float32Array(0); // input samples not yet consumed
    this._out = []; // output PCM16 samples awaiting a full frame
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const chan = input[0];
    if (!chan || chan.length === 0) return true;

    // Append this block to the leftover input buffer.
    const merged = new Float32Array(this._buf.length + chan.length);
    merged.set(this._buf, 0);
    merged.set(chan, this._buf.length);
    this._buf = merged;

    // Resample by reading at fractional positions spaced _ratio apart.
    while (this._pos + 1 < this._buf.length) {
      const idx = Math.floor(this._pos);
      const frac = this._pos - idx;
      const sample = this._buf[idx] * (1 - frac) + this._buf[idx + 1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this._out.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      this._pos += this._ratio;

      if (this._out.length >= FRAME_SAMPLES) {
        const pcm = new Int16Array(this._out);
        this._out.length = 0;
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }

    // Discard consumed input, keep the fractional tail for the next block.
    const consumed = Math.floor(this._pos);
    if (consumed > 0) {
      this._buf = this._buf.slice(consumed);
      this._pos -= consumed;
    }

    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
