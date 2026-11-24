import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {synthesizeDeepSeekScenes} from './deepseek-voice.mjs';

const plan = JSON.parse(await readFile(new URL('./jecheon.json', import.meta.url), 'utf8'));
const directory = await mkdtemp(path.join(tmpdir(), 'shorts-preview-'));
try {
  process.env.DEEPSEEK_VOICE = 'stella';
  await synthesizeDeepSeekScenes(plan.scenes, directory);
  const chunks = [];
  for (const [i] of plan.scenes.entries()) {
    const wav = await readFile(path.join(directory, i + '.wav'));
    chunks.push(wav.subarray(44), Buffer.alloc(9600));
  }
  const header = Buffer.from((await readFile(path.join(directory,'0.wav'))).subarray(0,44));
  const data = Buffer.concat(chunks);
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  process.stdout.write(Buffer.concat([header, data]).toString('base64'));
} finally {
  await rm(directory, {recursive:true, force:true});
}
