import { TTSProvider, SynthesisResult } from './types';

// ElevenLabs — the premium, characterful voice (this is where you'd design the
// "distinguished older British gentleman" Jarvis voice). Uses the low-latency
// Flash model by default. Needs ELEVENLABS_API_KEY; voice/model are configurable.
//
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  readonly producesAudio = true;

  private apiKey: string;
  private voiceId: string;
  private modelId: string;

  constructor() {
    this.apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
    // Default voice: 'George' (a warm, mature British male) — swap via env for
    // your own designed voice. Any voice id from your ElevenLabs library works.
    this.voiceId = (process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb').trim();
    // Flash v2.5 = ~75ms time-to-first-byte, 0.5 credits/char (the cheap, fast tier).
    this.modelId = (process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5').trim();

    if (!this.apiKey) {
      console.warn('[TTS:elevenlabs] ELEVENLABS_API_KEY is not set — synthesis will fail');
    }
    console.log(`[TTS:elevenlabs] Configured voice=${this.voiceId} model=${this.modelId}`);
  }

  async synthesize(text: string): Promise<SynthesisResult> {
    console.log('[TTS:elevenlabs] Synthesizing, chars:', text.length);
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY not configured');
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?output_format=mp3_44100_128`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[TTS:elevenlabs] API error ${res.status}: ${detail.slice(0, 300)}`);
        throw new Error(`ElevenLabs API ${res.status}`);
      }

      const audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      console.log('[TTS:elevenlabs] Synthesis OK, audio bytes(base64):', audioBase64.length);
      return { mode: 'server', audioBase64, mimeType: 'audio/mpeg' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
