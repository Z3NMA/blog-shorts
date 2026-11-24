import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDeepSeekPlan} from '../deepseek-planner.mjs';
import {synthesizeDeepSeekScenes} from '../deepseek-voice.mjs';

const photo = {lines:['따끈한 빵에 고기를 올려 먹어요.']};
const scene = {photo:1, text:'빵과 고기를 함께 먹어요.', evidence:'빵에 고기를'};

test('장면 번호와 본문 인용이 일치하는 대본만 사용한다', async () => {
  function planFor(editedScene) {
    const plan = {title:'한 입에 먹는 바비큐', scenes:[editedScene]};
    const request = async () => Response.json({choices:[
      {finish_reason:'stop', message:{content:JSON.stringify(plan)}}
    ]});
    return createDeepSeekPlan('바비큐', '', [photo], {apiKey:'test', request});
  }
  assert.deepEqual((await planFor(scene)).scenes[0], scene);
  assert.deepEqual((await planFor({...scene, caption:'예전 요약 자막'})).scenes[0], scene);
  await assert.rejects(planFor({...scene, photo:2}), /사진 번호/);
  await assert.rejects(planFor({...scene, evidence:'빠른 예약 필수'}), /근거/);
});

test('제목의 형식만 어긋나면 추가 요청 없이 유효한 장면과 제목을 사용한다', async () => {
  const article = '성수동 팝업 추천 토이스토리 팝업 후기 웨이팅 정보';
  const good = '성수 토이스토리\n웨이팅 정보';
  const family = '👨‍👩‍👧‍👦';
  const inputs = [
    [good, good], ['성수 토이스토리\\n웨이팅 정보', good],
    ['성수\t토이스토리\r\n\r\n웨이팅 정보', good], [good.split('\n'), good],
    [article, article], ['성수동 팝업 추천\n토이스토리 팝업\n후기 웨이팅 정보', article],
    [undefined, article], [42, article], ['\u200b\n\t', article],
    [family.repeat(15) + '\n성수 나들이', family.repeat(15) + '\n성수 나들이'],
    ['가'.repeat(50) + '\n웨이팅 정보', '가'.repeat(14) + '…\n웨이팅 정보']
  ];
  const segments = new Intl.Segmenter('ko', {granularity:'grapheme'});
  for (const [title, expected] of inputs) {
    let calls = 0;
    const request = async () => {
      assert.equal(++calls, 1);
      return Response.json({choices:[{finish_reason:'stop',
        message:{content:JSON.stringify({title, scenes:[scene]})}}]});
    };
    const plan = await createDeepSeekPlan(article, '', [photo], {apiKey:'test', request});
    const lines = plan.title.split('\n');
    assert.equal(calls, 1);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => line && [...segments.segment(line)].length <= 15));
    assert.equal(expected.includes('\n') ? plan.title : lines.join(' '), expected);
    assert.deepEqual(plan.scenes, [scene]);
  }
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
