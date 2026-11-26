import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const speechEndpoint = 'https://api.deepseek.com/v1/tools/tts';

// DeepSeek's PCM output is signed 16-bit little-endian mono at 24 kHz.
// Wrap a completed response in a WAV with a known length for scene timing.
function wavFromPcm(pcm) {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('DeepSeek에서 불완전한 음성을 받았습니다.');
  }
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function synthesizeDeepSeekScenes(scenes, directory) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error('DeepSeek 음성에는 API 키가 필요합니다.');
  const voice = process.env.DEEPSEEK_VOICE || 'stella';
  if (!['stella', 'tide'].includes(voice)) {
    throw new Error('DeepSeek 음성은 stella 또는 tide 중에서 선택하세요.');
  }

  for (const [index, scene] of scenes.entries()) {
    try {
      const response = await fetch(speechEndpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: scene.text, voice_id: voice, format: 'pcm' }),
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const mime = response.headers.get('content-type')?.split(';')[0].trim();
      if (!['audio/pcm', 'application/octet-stream'].includes(mime)) {
        throw new Error('PCM 오디오 응답이 아닙니다.');
      }
      const pcm = Buffer.from(await response.arrayBuffer());
      await writeFile(path.join(directory, index + '.wav'), wavFromPcm(pcm));
    } catch (error) {
      throw new Error('DeepSeek 음성 ' + (index + 1) + '번 장면 생성 실패 (' + error.message + ')');
    }
  }
}
