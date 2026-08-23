// Microphone capture for cloud STT mode. Opens getUserMedia, runs the audio
// through the pcm-worklet (which resamples to 16 kHz PCM16), and hands each
// frame to a sink (the WebSocket sender). Used only when STT_PROVIDER is a
// cloud recognizer; browser mode never touches this.
//
// We open the mic on demand (when a command window opens) and close it the
// moment the turn ends, so audio only streams — and only bills — while the
// user is actually giving a command, never during idle/wake listening.

export class CloudCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private running = false;
  private readonly onFrame: (frame: ArrayBuffer) => void;

  constructor(onFrame: (frame: ArrayBuffer) => void) {
    this.onFrame = onFrame;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[CloudCapture] Starting mic capture');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'pcm-worklet');
      this.node.port.onmessage = (e: MessageEvent) => {
        if (this.running) this.onFrame(e.data as ArrayBuffer);
      };
      // Source → worklet only. We deliberately do NOT connect to destination,
      // so the user never hears their own mic played back.
      this.source.connect(this.node);
      console.log('[CloudCapture] Capture running, ctx rate:', this.ctx.sampleRate);
    } catch (err) {
      console.error('[CloudCapture] Failed to start:', err);
      this.running = false;
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.ctx && !this.stream && !this.node) {
      this.running = false;
      return;
    }
    console.log('[CloudCapture] Stopping mic capture');
    this.running = false;
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch (_e) {
        /* ignore */
      }
    }
    try {
      this.source?.disconnect();
    } catch (_e) {
      /* ignore */
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch (_e) {
        /* ignore */
      }
    }
    this.node = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
  }
}
