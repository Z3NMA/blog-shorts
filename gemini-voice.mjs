import {writeFile, rename, stat} from 'node:fs/promises';
import path from 'node:path';

const narratorVoice = 'Leda';
const narrationStyle = [
  'Speak Korean in a warm, calm adult female voice, as if kindly explaining something to one listener.',
  'Use a slightly lower speaking pitch and a narrow pitch range. Give only a key word a subtle lift when it needs emphasis, then return to the baseline.',
  'For a short video, speak about 10% faster than everyday conversation. Start on the first word and link the words in each thought in one breath.',
  'Take a brief pause where the meaning changes. Keep Korean sentence endings like “-요” short and relaxed, and reactions understated.',
  'Pronounce names and numbers clearly enough to catch on the first listen. Keep the same timbre and comfortable volume across scenes.',
].join(' ');

export async function synthesizeGeminiScenes(scenes, directory, {
  apiKey = process.env.GEMINI_API_KEY,
  request = fetch,
  reuseCompleted = false,
} = {}) {
  for (const [index, scene] of scenes.entries()) {
    const file = path.join(directory, index + '.wav');
    if (reuseCompleted && await stat(file).then(info => info.size > 44, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) continue;
    if (!apiKey?.trim()) throw Error('Google AI Studio에서 발급한 Gemini API 키를 입력하세요.');
    const label = `Gemini 음성 · ${index + 1}/${scenes.length}장면`;
    console.log(label);
    const response = await request('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim()},
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: 'gemini-3.8-flash-tts',
        input: [{type: 'user_input', content: [{
          type: 'text', text: scene.text,
          annotations: [{type: 'speech_metadata', style: narrationStyle}],
        }]}],
        response_format: {type: 'audio'},
        generation_config: {speech_config: [{voice: narratorVoice}]},
      }),
    });
    if (!response.ok) {
      const advice = {
        400: '키가 유효한지 확인하세요.',
        401: 'Gemini API 키를 확인하세요.',
        403: 'Google 프로젝트의 모델 접근 권한과 결제 설정을 확인하세요.',
        404: 'Google 프로젝트에서 Gemini 3.8 Flash TTS를 사용할 수 있는지 확인하세요.',
        429: 'Google 프로젝트의 사용 한도와 잔여 할당량을 확인하세요.',
      };
      throw Error(`${label} 요청 실패 (HTTP ${response.status}). ${advice[response.status] || '잠시 후 다시 시도하세요.'}`);
    }
    const result = await response.json();
    const audio = result.steps?.filter(step => step.type === 'model_output')
      .flatMap(step => step.content || []).findLast(item => item.type === 'audio');
    const wav = Buffer.from(audio?.data || '', 'base64');
    if (wav.length <= 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
      throw Error(`${label}의 WAV 음성을 받지 못했습니다.`);
    }
    await writeFile(file + '.tmp', wav);
    await rename(file + '.tmp', file);
  }
}
