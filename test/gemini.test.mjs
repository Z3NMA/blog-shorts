import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {synthesizeGeminiScenes} from '../engine/gemini-voice.mjs';

test('Gemini sends the exact caption text per scene and saves Google WAV output', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gemini-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const scenes = [{text: '봄이 왔어요.'}, {text: '여기서 쉬어 가요!'}];
  const wav = Buffer.alloc(46);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  const sent = [];
  await synthesizeGeminiScenes(scenes, dir, {
    apiKey: 'test-key',
    request: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      const body = JSON.parse(options.body);
      const [turn] = body.input[0].content;
      assert.equal(body.model, 'gemini-3.8-flash-tts');
      assert.deepEqual(body.generation_config.speech_config, [{voice: 'Leda'}]);
      assert.equal(turn.annotations[0].type, 'speech_metadata');
      const {style} = turn.annotations[0];
      assert.match(style, /warm, calm/i);
      assert.match(style, /kindly explaining/i);
      assert.match(style, /slightly lower speaking pitch/i);
      assert.match(style, /narrow pitch range/i);
      assert.match(style, /only a key word a subtle lift/i);
      assert.match(style, /10% faster than everyday conversation/i);
      assert.match(style, /brief pause where the meaning changes/i);
      assert.match(style, /sentence endings.*short and relaxed/i);
      assert.equal(style.includes('gentle downward cadence'), sent.length === scenes.length - 1);
      sent.push(turn.text);
      return Response.json({steps: [{type: 'model_output', content: [
        {type: 'audio', data: wav.toString('base64')},
      ]}]});
    },
  });
  assert.deepEqual(sent, scenes.map(s => s.text));
  await synthesizeGeminiScenes(scenes, dir, {apiKey:'', reuseCompleted:true, request:assert.fail});
  for (const i of scenes.keys()) assert.deepEqual(await readFile(path.join(dir, i + '.wav')), wav);
});

test('missing keys, denied requests, and missing audio fail before rendering', async () => {
  const scenes = [{text: '안녕하세요.'}];
  const run = options => synthesizeGeminiScenes(scenes, '.', options);
  await assert.rejects(run({apiKey: '', request: assert.fail}), /API 키/);
  await assert.rejects(run({apiKey: 'test', sleep:async () => {}, request: () => new Response(null, {status: 429})}), /429/);
  await assert.rejects(run({apiKey: 'test', request: () => Response.json({steps: []})}), /WAV/);
});
