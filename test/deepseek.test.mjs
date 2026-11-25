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
const wrapUp = '따끈한 빵 좋아하시면 바비큐를 올려 한 입 드셔 보세요.';
const singleSceneDraft = {openingText:scene.text, scenes:[], closing:null};
const singleScene = {...scene, text:scene.text + ' ' + wrapUp};
const completion = value => Response.json({choices:[
  {finish_reason:'stop', message:{content:JSON.stringify(value)}}
]});
const exhausted = () => Response.json({error:{message:'Daily quota exceeded'}},{status:429});

function writerAndReviewer(draft, review) {
  return async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    return completion(input.scenes ? review : draft);
  };
}

test('세 번째 요청은 검증된 제목과 첫 장면부터 마지막까지의 전체 대사를 순서대로 읽는다', async () => {
  const calls = [];
  const middle = {photo:2, text:'고기는 참나무로 훈연했어요.', evidence:'참나무로 훈연'};
  const tea = {photo:3, text:'차는 따뜻하게 나와요.', evidence:'따뜻한 차'};
  const invitation = '은은한 훈연 향 좋아하시면 바비큐를 빵에 올려 드셔 보세요.';
  const request = async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    calls.push(input);
    if (calls.length === 1) {
      assert.equal(input.opening, undefined);
      return completion({candidates:[{...opening, evidence:'원문에 없는 가격'}, opening]});
    }
    if (calls.length === 2) {
      assert.deepEqual(input, {...calls[0], opening});
      return completion({openingText:scene.text, scenes:[scene, middle, tea], closing:tea});
    }
    assert.deepEqual(input, {title:opening.title, scenes:[scene, middle, tea]});
    assert.match(body.messages[0].content, /시청자에게 직접/);
    return completion({wrapUp:invitation});
  };
  const photos = [photo, {lines:['참나무로 훈연했어요.']}, {lines:['따뜻한 차도 나와요.']}];
  const plan = await createDeepSeekPlan('바비큐', '', photos, {apiKey:'test', request});
  assert.equal(calls.length, 3);
  assert.deepEqual(plan, {title:opening.title, ending:{body:tea.text,text:invitation}, scenes:[scene, middle, {...tea, text:tea.text + ' ' + invitation}]});
});

test('두 단계 모두 사진 번호와 인용을 확인한다', async () => {
  await assert.rejects(createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', request:async () => completion({candidates:[{...opening, photo:2}]})
  }), /첫 사진/);
  function planFor(editedScene) {
    const request = writerAndReviewer({openingText:scene.text, scenes:[], closing:editedScene}, {wrapUp});
    return createDeepSeekPlan('바비큐', '', [photo, photo], {apiKey:'test', cachedOpening:opening, request});
  }
  const next = {...scene, photo:2};
  assert.deepEqual((await planFor({...next, caption:'별도 요약 자막'})).scenes[1], {...next, text:next.text + ' ' + wrapUp});
  await assert.rejects(planFor({...next, photo:3}), /사진 번호/);
  await assert.rejects(planFor({...next, evidence:'빠른 예약 필수'}), /근거/);
  await assert.rejects(planFor({...next, photo:1}), /마무리/);
});

test('마지막 사진을 중간과 중복해도 근거 있는 마무리 대사가 맨 끝에 남는다', async () => {
  const middle = {...scene, photo:2};
  const closing = {photo:3, text:'마지막 한 입도 빵과 함께 먹기 좋아요.', evidence:scene.evidence};
  const write = draft => createDeepSeekPlan('바비큐', '', [photo, photo, photo], {
    apiKey:'test', cachedOpening:opening, request:writerAndReviewer(draft, {wrapUp}),
  });
  const plan = await write({openingText:scene.text, scenes:[{...closing,text:'이전 디테일'},middle], closing});
  assert.deepEqual(plan.scenes, [scene,middle,{...closing, text:closing.text + ' ' + wrapUp}]);
  await assert.rejects(write({openingText:scene.text, scenes:[middle], closing:null}), /마무리/);
});

test('집필이 실패하면 저장해 둔 첫 장면부터 이어서 집필한다', async () => {
  let cachedOpening;
  const request = async () => cachedOpening ? exhausted() : completion({candidates:[opening]});
  await assert.rejects(createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', request, onOpening:value => { cachedOpening = value; },
  }), /429/);
  assert.deepEqual(cachedOpening, opening);
  const plan = await createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', cachedOpening, onOpening:assert.fail, request:writerAndReviewer(singleSceneDraft, {wrapUp}),
  });
  assert.deepEqual(plan, {title:opening.title, ending:{body:scene.text,text:wrapUp}, scenes:[singleScene]});
});

test('마무리 요청 실패 후 이미 작성한 대본을 그대로 사용해 마무리만 재시도한다', async () => {
  let cachedDraft;
  await assert.rejects(createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', cachedOpening:opening, onDraft:value => { cachedDraft = value; },
    request:async () => cachedDraft ? exhausted() : completion(singleSceneDraft),
  }), /429/);
  assert.deepEqual(cachedDraft, singleSceneDraft);
  let calls = 0;
  const plan = await createDeepSeekPlan('바비큐', '', [photo], {
    apiKey:'test', cachedOpening:opening, cachedDraft, onOpening:assert.fail, onDraft:assert.fail,
    request:async (_url, options) => {
      calls++;
      assert.deepEqual(JSON.parse(JSON.parse(options.body).messages[1].content), {title:opening.title, scenes:[scene]});
      return completion({wrapUp});
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(plan.scenes, [singleScene]);
});

test('마지막 경험담 뒤에 별도의 끝맺음이 정확히 한 번 들어간다', async () => {
  const detail = '줄은 길었는데, 포장된 오니기리라 제 차례는 금방 왔어요.';
  const invitation = '대구 신세계에서 간단히 한 끼 챙기고 싶다면 오니기리 한번 드셔 보세요.';
  const write = (text, wrapUp) => createDeepSeekPlan('교토 오니마루', '', [photo, {lines:[detail]}], {
    apiKey:'test', cachedOpening:opening, request:writerAndReviewer({
      openingText:scene.text, scenes:[], closing:{photo:2, evidence:detail, text},
    }, {wrapUp}),
  });
  const expected = detail + ' ' + invitation;
  for (const text of [detail, detail.slice(0,-1), expected]) {
    const plan = await write(text, invitation);
    assert.equal(plan.scenes.length, 2);
    assert.equal(plan.scenes.at(-1).text, expected);
  }
  await assert.rejects(write(detail, undefined), /끝맺음/);
  await assert.rejects(write(detail, detail.slice(0,-1)), /반복/);
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
    const replies = [{candidates:[{...opening, title}]}, singleSceneDraft, {wrapUp}];
    const request = async () => completion(replies[calls++]);
    const plan = await createDeepSeekPlan(article, '', [photo], {apiKey:'test', request});
    const lines = plan.title.split('\n');
    assert.equal(calls, 3);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => line && [...segments.segment(line)].length <= 15));
    assert.equal(expected.includes('\n') ? plan.title : lines.join(' '), expected);
    assert.deepEqual(plan.scenes, [singleScene]);
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
