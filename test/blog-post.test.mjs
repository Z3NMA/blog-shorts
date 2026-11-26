import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlogPost} from '../engine/blog-post.mjs';
import {createDeepSeekPlan} from '../engine/deepseek-planner.mjs';

const image = src => `<img class="se-image-resource" data-lazy-src="${src}">`;
const note = text => `<p class="se-text-paragraph">${text}</p>`;

test('대표 사진의 CDN과 파일명 인코딩이 달라도 제외하고 본문 사진의 원래 번호를 유지한다', async () => {
  const key = '/MjAyNjExMjNfNSAg/MDAxNzk1NDIwMDg3MjY5.signature.other.JPEG/';
  const cover = 'https://blogthumb.pstatic.net' + key + '%BC%F6.jpg?type=w2';
  const bodyVersion = 'https://mblogthumb-phinf.pstatic.net' + key + '%EC%88%98.jpg?type=w800';
  const html = `<meta content='${cover}' property='og:image'>` +
    image('https://example.com/first.jpg') + note('첫 번째 메뉴') +
    image(bodyVersion) + note('글에 소개한 메뉴') + image('https://example.com/last.jpg') + note('포장 대기 시간');
  const {photos} = parseBlogPost(html);
  assert.deepEqual(photos.map(p => p.isCover), [false,true,false]);
  let calls = 0;
  const request = async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    calls++;
    if (input.scenes) {
      assert.deepEqual(input.scenes.map(s => s.photo), [1,3]);
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({wrapUp:'포장 메뉴를 찾으시면 한번 들러 보세요.'})}}]});
    }
    assert.deepEqual(input.photos.map(p => p.photo), [1,3]);
    assert.equal(input.photos[1].before, '글에 소개한 메뉴');
    const result = calls === 1 ? {candidates:[
      {title:'메뉴',photo:2,evidence:'글에 소개한 메뉴'}, {title:'본문 메뉴',photo:1,evidence:'첫 번째 메뉴'},
    ]} : {openingText:'첫 번째 메뉴예요.',scenes:[],closing:{photo:3,text:'포장할 때는 대기 시간을 확인해요.',evidence:'포장 대기 시간'}};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  };
  const plan = await createDeepSeekPlan('메뉴', '', photos, {
    apiKey:'test', request, cachedOpening:{title:'이전 제목',photo:2,evidence:'글에 소개한 메뉴'},
  });
  assert.equal(calls, 3);
  assert.deepEqual(plan.scenes.map(s => s.photo), [1,3]);
});

test('파일명으로 만든 표지를 거르고 일반 단독 사진과 서로 다른 프록시 사진은 보존한다', async () => {
  const ordinary = 'https://example.com/proxy?src=food';
  const meta = `<meta property="og:image" content="${ordinary}">`;
  assert.equal(parseBlogPost(meta + image(ordinary)).photos[0].isCover, false);
  assert.deepEqual(parseBlogPost(meta + image(ordinary) + image('https://example.com/proxy?src=shop'))
    .photos.map(p => p.isCover), [true,false]);
  const {photos} = parseBlogPost(image('https://example.com/B_%EC%8D%B8%EB%84%A4%EC%9D%BC.jpg') + note('가게 소개'));
  await assert.rejects(createDeepSeekPlan('가게', '', photos, {apiKey:'test',request:assert.fail}), /본문 사진/);
});
