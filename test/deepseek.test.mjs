import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDeepSeekPlan} from '../deepseek-planner.mjs';
import {synthesizeDeepSeekScenes} from '../deepseek-voice.mjs';

const photo = {lines:['따끈한 빵에 고기를 올려 먹어요.']};
const scene = {photo:1, text:'빵과 고기를 함께 먹어요.', evidence:'빵에 고기를'};
const opening = {title:'바비큐 한 접시\n빵에 올려 한 입', photo:1, evidence:scene.evidence};
const completion = value => Response.json({choices:[
  {finish_reason:'stop', message:{content:JSON.stringify(value)}}
]});

test('근거 있는 제목과 첫 사진을 먼저 고르고 다음 요청에서 그 조합으로 대사를 쓴다', async () => {
  const calls = [];
  const tea = {photo:2, text:'차는 따뜻하게 나와요.', evidence:'따뜻한 차'};
  const request = async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    calls.push(input);
    if (calls.length === 1) {
      assert.equal(input.opening, undefined);
      return completion({candidates:[{...opening, evidence:'원문에 없는 가격'}, opening]});
    }
    assert.deepEqual(input, {...calls[0], opening});
    return completion({openingText:scene.text, scenes:[scene, tea, tea]});
  };
  const plan = await createDeepSeekPlan('바비큐', '', [photo, {lines:['따뜻한 차도 나와요.']}], {apiKey:'test', request});
  assert.equal(calls.length, 2);
  assert.deepEqual(plan, {title:opening.title, scenes:[scene, tea]});
});

test('두 단계 모두 사진 번호와 인용을 확인한다', async () => {
  await assert.rejects(createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', request:async () => completion({candidates:[{...opening, photo:2}]})
  }), /첫 사진/);
  function planFor(editedScene) {
    const request = async () => completion({openingText:scene.text, scenes:[editedScene]});
    return createDeepSeekPlan('바비큐', '', [photo, photo], {apiKey:'test', cachedOpening:opening, request});
  }
  const next = {...scene, photo:2};
  assert.deepEqual((await planFor({...next, caption:'별도 요약 자막'})).scenes[1], next);
  await assert.rejects(planFor({...next, photo:3}), /사진 번호/);
  await assert.rejects(planFor({...next, evidence:'빠른 예약 필수'}), /근거/);
});

test('집필이 실패하면 저장해 둔 첫 장면으로 집필만 재시도한다', async () => {
  let cachedOpening;
  const request = async () => cachedOpening ? new Response(null, {status:429}) : completion({candidates:[opening]});
  await assert.rejects(createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', request, onOpening:value => { cachedOpening = value; },
  }), /429/);
  assert.deepEqual(cachedOpening, opening);
  const plan = await createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', cachedOpening, onOpening:assert.fail, request:async () => completion({openingText:scene.text, scenes:[]}),
  });
  assert.deepEqual(plan, {title:opening.title, scenes:[scene]});
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
    const request = async () => ++calls === 1
      ? completion({candidates:[{...opening, title}]})
      : completion({openingText:scene.text, scenes:[]});
    const plan = await createDeepSeekPlan(article, '', [photo], {apiKey:'test', request});
    const lines = plan.title.split('\n');
    assert.equal(calls, 2);
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
