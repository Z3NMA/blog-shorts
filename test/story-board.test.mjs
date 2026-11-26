import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekPlan, proposeStories, setReviewEnding, suggestReviewEnding} from '../engine/deepseek-planner.mjs';
import {editScenes} from '../engine/scene-editor.mjs';

const photos = [
  {lines:['산 너머에 가게가 있어요.']}, {lines:['모닝빵에 고기를 넣어요.']},
  {lines:['평일에만 빵 두 개가 3,000원이에요.']}, {isCover:true, lines:['대표 사진이에요.']},
];
const openings = [
  {title:'산골 바비큐\n산을 보며 먹는 곳',photo:1,evidence:'산 너머에'},
  {title:'작은 버거\n빵에 고기를 담아',photo:2,evidence:'모닝빵에 고기를'},
];
const reply = value => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});

test('이야기 목록은 검증된 후보만 모으고 집필을 선택 시점까지 미룬다', async () => {
  let calls = 0;
  const choices = await proposeStories('바비큐', '', photos, {apiKey:'test', request:async () => {
    calls++;
    return reply({candidates:[{...openings[0],evidence:'없는 인용'}, {...openings[1],photo:4},
      {...openings[0],title:'전 메뉴\n1,000원'}, openings[0], openings[0], openings[1]]});
  }});
  assert.equal(calls, 1);
  assert.deepEqual(choices, openings);
  const plan = await createDeepSeekPlan('바비큐', '', photos, {selectedOpening:choices[1], apiKey:'test',
    request:async (_, init) => {
      const input = JSON.parse(JSON.parse(init.body).messages[1].content);
      if (calls++ === 1) {
        assert.deepEqual(input.opening, openings[1]);
        return reply({openingText:'빵에 고기를 넣어요.', scenes:[], closing:null});
      }
      assert.equal(input.title, openings[1].title);
      return reply({wrapUp:'고기를 좋아하시면 빵에 넣어 드셔 보세요.'});
    }});
  assert.equal(calls, 3);
  assert.equal(plan.scenes[0].photo, 2);
  await assert.rejects(createDeepSeekPlan('바비큐', '', photos, {apiKey:'test',
    selectedOpening:{...openings[0], photo:4}, request:assert.fail}), /선택한 이야기/);
});

test('사진 교체와 대사 편집은 원래 인용을 보존하고 가격 오류는 편집 전체를 반려한다', () => {
  const plan = {title:'바비큐', scenes:[{photo:1,evidence:'산 너머에',text:'산을 봐요.'},
    {photo:2,evidence:'모닝빵에 고기를',text:'빵에 고기를 넣어요.'}]};
  setReviewEnding(plan, '함께 드셔 보세요.');
  const before = structuredClone(plan);
  const edits = {scenes:[{photo:2,text:'살짝 구운 빵이에요.'},{photo:3,text:photos[2].lines[0]}], ending:'둘이 나눠 드셔 보세요.'};
  const result = editScenes(plan, edits, photos, []);
  assert.deepEqual(result.scenes.map(s => s.evidencePhoto), [1,2]);
  assert.equal(result.scenes[1].evidence, plan.scenes[1].evidence);
  assert.equal(result.scenes[1].text, photos[2].lines[0] + ' ' + edits.ending);
  assert.equal(editScenes(result, {photo:1}, photos, []).scenes[0].evidencePhoto, undefined);
  for (const invalid of [{photo:2,text:'빵은 무료예요.'},{photo:4,text:'표지예요.'},
    {photo:1,text:' '},{photo:1,text:'가'.repeat(181)},{photo:1,text:'줄\n바꿈'}]) {
    assert.throws(() => editScenes(plan, {scenes:[edits.scenes[0],invalid]}, photos, []), /2번째 장면/);
  }
  assert.throws(() => editScenes(plan, {scenes:[]}, photos, []), /장면 수/);
  assert.deepEqual(plan, before);
});

test('한 장면 영상에서도 AI 마무리는 방금 수정한 경험담을 읽고 기존 원고를 보존한다', async () => {
  const plan = {title:'바비큐',scenes:[{photo:1,evidence:'산 너머에',text:'산을 봐요.'}]};
  setReviewEnding(plan, '들러 보세요.');
  const scenes = [{photo:2,text:'따뜻한 빵에 고기를 끼워 먹었어요.'}];
  const current = editScenes(plan, {scenes,ending:''}, photos, [], {suggesting:true});
  const text = await suggestReviewEnding(current, {apiKey:'test',request:async (_, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.equal(input.scenes[0].text, scenes[0].text);
    assert.equal(input.scenes[0].photo, 2);
    return reply({wrapUp:'빵과 고기를 함께 즐겨 보세요.'});
  }});
  const result = editScenes(plan, {scenes,ending:text}, photos, []);
  assert.equal(result.scenes[0].text, scenes[0].text + ' ' + text);
  assert.equal(plan.ending.body, '산을 봐요.');
});
