import { TTSProvider, SynthesisResult } from './types';

// Cartesia Sonic — the cheap, ultra-low-latency option (~40-90ms TTFA, a
// fraction of ElevenLabs' per-character cost). Good default when you want a
// real (non-browser) voice without the premium bill. Needs CARTESIA_API_KEY
// and a CARTESIA_VOICE_ID from your Cartesia voice library.
//
// Docs: https://docs.cartesia.ai/api-reference/tts/bytes
export class CartesiaTTSProvider implements TTSProvider {
  readonly name = 'cartesia';
  readonly producesAudio = true;

  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private version: string;

  constructor() {
    this.apiKey = (process.env.CARTESIA_API_KEY || '').trim();
    this.voiceId = (process.env.CARTESIA_VOICE_ID || '').trim();
    this.modelId = (process.env.CARTESIA_MODEL || 'sonic-2').trim();
    this.version = (process.env.CARTESIA_VERSION || '2024-11-13').trim();

    if (!this.apiKey) {
      console.warn('[TTS:cartesia] CARTESIA_API_KEY is not set — synthesis will fail');
    }
    if (!this.voiceId) {
      console.warn('[TTS:cartesia] CARTESIA_VOICE_ID is not set — pick one from your Cartesia library');
    }
    console.log(`[TTS:cartesia] Configured voice=${this.voiceId || '(unset)'} model=${this.modelId}`);
  }

  async synthesize(text: string): Promise<SynthesisResult> {
    console.log('[TTS:cartesia] Synthesizing, chars:', text.length);
    if (!this.apiKey) throw new Error('CARTESIA_API_KEY not configured');
    if (!this.voiceId) throw new Error('CARTESIA_VOICE_ID not configured');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': this.version,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: this.modelId,
          transcript: text,
          voice: { mode: 'id', id: this.voiceId },
          language: 'en',
          output_format: {
            container: 'mp3',
            sample_rate: 44100,
            bit_rate: 128000,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[TTS:cartesia] API error ${res.status}: ${detail.slice(0, 300)}`);
        throw new Error(`Cartesia API ${res.status}`);
      }

      const audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      console.log('[TTS:cartesia] Synthesis OK, audio bytes(base64):', audioBase64.length);
      return { mode: 'server', audioBase64, mimeType: 'audio/mpeg' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
