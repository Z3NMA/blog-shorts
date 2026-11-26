import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekPlan, setReviewEnding, suggestReviewEnding} from '../engine/deepseek-planner.mjs';
import {verifyPrices} from '../engine/price-check.mjs';
import {retryRateLimit} from '../engine/rate-limit.mjs';
import {captionCards, sceneAss, templates} from '../engine/video-templates.mjs';

const source = ['평일에만 햄치즈 두 개가 6,800원이에요.', '김치제육은 4,500원이에요.'];
const detail = '줄은 길었는데, 포장된 오니기리라 제 차례는 금방 왔어요.';
const ending = '대구 신세계에서 간단히 한 끼 챙기고 싶다면, 교토 오니마루에서 햄치즈 무스비 한번 드셔 보세요.';
const completion = value => Response.json({choices:[{finish_reason:'stop', message:{content:JSON.stringify(value)}}]});

test('가격과 메뉴·수량·조건을 한 문장으로 검증한다', () => {
  for (const line of [...source,'김치제육은 4500원입니다.','가격은 메뉴판에서 확인해 보세요.']) verifyPrices(line,source);
  for (const line of ['전 메뉴가 4,500원이에요.','햄치즈는 4,500원이에요.','햄치즈 두 개가 6,800원이에요.',
    '평일에만 햄치즈 한 개가 6,800원이에요.','4,500원','한 그릇이 오천 원이에요.','무료예요.']) {
    assert.throws(() => verifyPrices(line,source), /가격/);
  }
});

test('제목 후보의 가격을 검사하고 근거가 부족한 가격 대사는 한 번 다시 쓴다', async () => {
  const photos = [{lines:source}];
  const opening = {title:'메뉴판\n김치제육',photo:1,evidence:'김치제육은 4,500원'};
  const draft = {openingText:'전 메뉴가 4,500원이에요.',scenes:[],closing:null};
  const replies = [{candidates:[{...opening,title:'모든 메뉴\n4,500원'},opening]},draft,
    {...draft,openingText:source[1]}, {wrapUp:'김치제육을 좋아하시면 들러 보세요.'}];
  const plan = await createDeepSeekPlan('메뉴판','',photos,{apiKey:'test',request:async () => completion(replies.shift())});
  assert.equal(replies.length,0);
  assert.equal(plan.ending.body,source[1]);
  assert.equal(plan.title,opening.title);
});

test('직접 수정과 AI 다시 쓰기는 앞 대사와 기존 편집을 보존한다', async () => {
  const plan = {title:'오니기리',scenes:[{photo:1,text:'메뉴를 골랐어요.'},{photo:2,text:detail}]};
  setReviewEnding(plan,ending);
  setReviewEnding(plan,'간단한 식사를 찾으시면 들러 보세요.');
  const before = structuredClone(plan);
  const next = await suggestReviewEnding(plan,{apiKey:'test',previous:plan.ending.text,request:async (_url,req) => {
    const input = JSON.parse(JSON.parse(req.body).messages[1].content);
    assert.deepEqual(input.scenes.map(s => s.text),['메뉴를 골랐어요.',detail]);
    assert.equal(input.previousEnding,plan.ending.text);
    return completion({wrapUp:'근처에서 한 끼 챙기실 때 들러 보세요.'});
  }});
  assert.deepEqual(plan,before);
  setReviewEnding(plan,next);
  assert.equal(plan.scenes[1].text,detail + ' ' + next);
  assert.throws(() => setReviewEnding(plan,'전 메뉴가 4,500원이에요.',source),/가격/);
});

test('429 서버 대기시간과 재시도 상한을 지키고 일일 한도는 즉시 알린다', async () => {
  const limited = (error,headers) => Response.json({error},{status:429,headers});
  const waits = [];
  const send = [limited({details:[{retryDelay:'2.5s'}]},{'Retry-After':'1'}),limited({}, {'Retry-After':'3'}),new Response('ok')];
  const ok = await retryRateLimit(() => send.shift(),'테스트',async ms => waits.push(ms));
  assert.equal(await ok.text(),'ok'); assert.deepEqual(waits,[2500,3000]);
  for (const [reply,reason] of [[limited({details:[{violations:[{quotaId:'RequestsPerDayPerProject'}]}]}),/일일/],
    [limited({details:[{violations:[{quotaValue:'0'}]}]}),/결제/], [limited({}, {'Retry-After':'3600'}),/3600초/]]) {
    await assert.rejects(retryRateLimit(() => reply,'테스트',assert.fail),reason);
  }
  let calls = 0; const fallback = [];
  await assert.rejects(retryRateLimit(() => {calls++; return limited({});},'테스트',async ms => fallback.push(ms)), /429/);
  assert.equal(calls,4); assert.ok(fallback[0]<fallback[1] && fallback[1]<fallback[2]);
});

test('자막은 문장별로 균형을 잡고 마지막 어절을 혼자 남기지 않는다', () => {
  const text = detail + ' ' + ending;
  const cards = captionCards(text);
  assert.equal(cards.flat().join(' '),text);
  assert.ok(cards.every(card => card.length <= 2 && card.every(line => line.length<=15)));
  assert.ok(cards.flat().some(row => row.includes('금방 왔어요.')));
  assert.ok(cards.flat().at(-1).includes('드셔 보세요.'));
  assert.ok(cards.every(card => !card.join(' ').includes('왔어요. 대구')));
  assert.equal(captionCards('가'.repeat(41)).flat().join(''),'가'.repeat(41));
  const times = sceneAss(templates[0],'제목',text,8,8.2).split('\n').filter(l => l.includes(',Caption,,')).map(l => l.split(',').slice(1,3));
  assert.equal(times[0][0],'0:00:00.00');
  assert.equal(times.at(-1)[1],'0:00:08.20');
  assert.ok(times.every(([a,b],i) => a < b && (!i || times[i-1][1] === a)));
});

test('긴 명칭 뒤의 짧은 끝말은 줄과 자막 화면에서 분리되지 않는다', () => {
  for (const lead of ['입구에는', '입구를 지나 안쪽으로 쭉 들어가면']) {
    for (const name of ['자리도','기념품이','어린이체험안내판이','전기자동차충전전용구역이']) {
      for (const tail of ['있어요.', '없어요!', '있었어요.', '있습니다.', '있어요…', '있어요.”']) {
        const text = [lead,name,tail].join(' ');
        const cards = captionCards(text);
        assert.equal(cards.flat().join(' '),text);
        assert.ok(cards.every(card => card.length <= 2));
        assert.ok(cards.at(-1).at(-1).endsWith(name + ' ' + tail));
      }
    }
  }
  for (const gap of [' ', '\n', '\r\n','\t','\u2028']) {
    assert.ok(captionCards('간단히 데워 먹을 수' + gap + '있어요.').at(-1).at(-1).endsWith('먹을 수 있어요.'));
  }
  assert.deepEqual(captionCards('단체석이 있나요?\n있어요.'),[['단체석이 있나요?'],['있어요.']]);
  const unspaced = '가'.repeat(15) + '있어요.';
  const rows = captionCards(unspaced).flat();
  assert.equal(rows.join(''),unspaced);
  assert.ok(rows.at(-1).endsWith('있어요.') && rows.at(-1) !== '있어요.');
});

test('일곱 스타일의 실제 ASS에서도 긴 끝 구절은 화면 폭에 맞춰 같은 줄에 표시된다', () => {
  const phrase = '전기자동차충전전용구역이 있어요.';
  for (const style of templates) {
    const captions = sceneAss(style,'주차장','주차장 옆에는 ' + phrase,5,5.2)
      .split('\n').filter(l => l.includes(',Caption,,'));
    assert.equal(captions.length,1);
    assert.ok(captions[0].endsWith('주차장 옆에는\\N' + phrase));
    assert.ok(captions[0].includes('\\fs' + Math.floor(style.text.Caption.size*15/phrase.length) + '}'));
    const normal = sceneAss(style,'분식집','먹을 수 있어요.',2,2.2)
      .split('\n').find(l => l.includes(',Caption,,'));
    assert.ok(normal.endsWith('}먹을 수 있어요.') && !normal.includes('\\fs'));
  }
});

test('문장의 끝말은 언어·글자 수와 관계없이 앞 문맥과 같은 자막 화면에 남는다', () => {
  const starts = ['이용 시간은','안내판에 적힌 마지막 회차는','아침에 둘러본 상점의 안내 문구는','입구를 지나 안쪽으로 쭉 들어가면'];
  const labels = ['주말에도','전기자동차충전전용구역은','어린이체험프로그램안내판에는','간편결제단말기에는'];
  const tails = ['보세요.','거예요.','3,400원.','OPEN.','추천드리더라고요.','예약가능시간입니다.','16:30.','🥐','Takeaway.'];
  for (const start of starts) for (const label of labels) for (const tail of tails) {
    const text = [start,label,tail].join(' ');
    const cards = captionCards(text);
    assert.equal(cards.flat().join(' '),text);
    assert.ok(cards.at(-1).join(' ').endsWith(label + ' ' + tail));
    if (label.length + 1 + tail.length <= 23)
      assert.ok(cards.at(-1).at(-1).endsWith(label + ' ' + tail));
  }
  assert.deepEqual(captionCards('입장할까요? OK.'),[['입장할까요?'],['OK.']]);
  assert.deepEqual(captionCards('😋'),[['😋']]);
});

test('한 단어짜리 화면을 피할 수 있으면 줄을 다시 배치하고 긴 코드의 철자를 보존한다', () => {
  const text = '이곳에서 문화체험프로그램예약안내는 주말사전예약우선접수입니다.';
  assert.deepEqual(captionCards(text),[['이곳에서 문화체험프로그램예약안내는','주말사전예약우선접수입니다.']]);
  const code = 'ELECTRICVEHICLECHARGING.';
  const cards = captionCards('관람을 마치고 만난 어린이체험프로그램안내판은 ' + code);
  assert.ok(cards.at(-1).join('').endsWith('어린이체험프로그램안내판은 ' + code));
  const veryLong = 'ABC012'.repeat(20);
  assert.equal(captionCards(veryLong).flat().join(''),veryLong);
  assert.ok(captionCards(veryLong).every(c => c.length <= 2 && c.every(row => row.length <= 23)));
});
