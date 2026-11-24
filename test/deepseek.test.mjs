import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDeepSeekPlan} from '../deepseek-planner.mjs';
import {synthesizeDeepSeekScenes} from '../deepseek-voice.mjs';

const photo = {lines:['따끈한 빵에 고기를 올려 먹어요.']};
const scene = {photo:1, text:'빵과 고기를 함께 먹어요.', caption:'따끈한 빵과 고기', evidence:'빵에 고기를'};

test('장면 번호와 본문 인용이 일치하는 대본만 사용한다', async () => {
  function planFor(editedScene) {
    const plan = {title:'한 입에 먹는 바비큐', scenes:[editedScene]};
    const request = async () => Response.json({choices:[
      {finish_reason:'stop', message:{content:JSON.stringify(plan)}}
    ]});
    return createDeepSeekPlan('바비큐', '', [photo], {apiKey:'test', request});
  }
  assert.deepEqual((await planFor(scene)).scenes[0], scene);
  await assert.rejects(planFor({...scene, photo:2}), /사진 번호/);
  await assert.rejects(planFor({...scene, evidence:'빠른 예약 필수'}), /근거/);
});

test('한국어 대사를 한 번 요청하고 실제 PCM 길이로 WAV를 기록한다', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'shorts-test-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test';
  t.after(() => {
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  });
  const request = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/tts');
    assert.equal(JSON.parse(init.body).text, scene.text);
    return new Response(Buffer.alloc(48000), {headers:{'content-type':'audio/pcm'}});
  });
  await synthesizeDeepSeekScenes([scene], dir);
  assert.equal(request.mock.callCount(), 1);
  const wav = await readFile(path.join(dir, '0.wav'));
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 48000);
});
