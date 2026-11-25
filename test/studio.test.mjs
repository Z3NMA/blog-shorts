import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const available = spawnSync(ffmpeg,['-version'],{windowsHide:true}).status === 0;
const engine = fileURLToPath(new URL('../shorts.mjs',import.meta.url));

test('첫 사진 교체는 대사를 보존하고, 손상된 마지막 사진은 음성 요청 전에 차단한다',
  {skip:available ? false : 'FFmpeg가 필요합니다.'}, async t => {
    const dir = await mkdtemp(path.join(tmpdir(),'shorts-studio-'));
    t.after(() => rm(dir,{recursive:true,force:true}));
    const file = name => path.join(dir,name);
    const json = async name => JSON.parse(await readFile(file(name),'utf8'));
    const ending = {body:'줄이 금방 줄었어요.',text:'근처라면 들러 보세요.'};
    const last = {photo:3,text:ending.body+' '+ending.text};
    const plan = {title:'분식집\n따뜻한 한 끼',scenes:[{photo:1,text:'음식을 골랐어요.'},last],ending};
    const html = [1,2,3].map(i => '<img class="se-image-resource" src="https://example.com/'+i+'.jpg">').join('');
    await writeFile(file('plan.json'),JSON.stringify(plan));
    await writeFile(file('post.html'),html);
    const ppm = shade => Buffer.concat([Buffer.from('P6\n8 8\n255\n'),Buffer.alloc(8*8*3,shade)]);
    await writeFile(file('1.jpg'),ppm(40));
    await writeFile(file('2.jpg'),ppm(190));
    await writeFile(file('3.jpg'),'broken');
    const worker = (action,edit={}) => spawnSync(process.execPath,[engine,'https://blog.naver.com/test/123',file('out.mp4')],{
      env:{...process.env,FFMPEG:ffmpeg,SHORTS_SESSION:dir,PHOTO_DIR:dir,SHORTS_ACTION:action,SHORTS_TEMPLATE:'white',
        SHORTS_EDIT:JSON.stringify(edit),SHORTS_VOICE:'gemini',GEMINI_API_KEY:'',SHORTS_PLAN_PATH:''},
      windowsHide:true,encoding:'utf8',
    });
    const success = result => assert.equal(result.status,0,result.stderr);
    success(worker('prepare'));
    const initial = await json('preview.json');
    success(worker('apply',{photo:2}));
    const preview = await json('preview.json');
    assert.equal(preview.styles.length,7);
    assert.notEqual(preview.styles[0].image,initial.styles[0].image);
    assert.equal(preview.firstText,initial.firstText);
    assert.equal(preview.photo,2);
    assert.deepEqual((await json('plan.json')).scenes[1],last);
    const failed = worker('render');
    assert.notEqual(failed.status,0);
    assert.match(failed.stderr,/2번째 장면의 본문 사진 3번/);
    assert.doesNotMatch(failed.stdout,/Gemini 음성/);
    await writeFile(file('3.jpg'),ppm(100));
    await writeFile(file('photo-3'),'old corrupt cache');
    assert.match(worker('render').stderr,/Gemini API 키/);
    assert.deepEqual(await readFile(file('photo-3')),ppm(100));
    for (const name of ['0.wav','1.wav','voice.ready']) await writeFile(file(name),'cached');
    success(worker('apply',{ending:'따뜻한 식사를 찾으시면 들러 보세요.'}));
    assert.equal(await readFile(file('0.wav'),'utf8'),'cached');
    for (const name of ['1.wav','voice.ready']) await assert.rejects(readFile(file(name)),{code:'ENOENT'});
  });

test('같은 글의 두 이야기는 사진을 공유하고 편집된 장면 음성만 폐기한다',
  {skip:available ? false : 'FFmpeg가 필요합니다.'}, async t => {
    const root = await mkdtemp(path.join(tmpdir(),'shorts-stories-'));
    t.after(() => rm(root,{recursive:true,force:true}));
    const common = name => path.join(root, name);
    const local = (id,name) => common(path.join('story-' + id,name));
    const photos = [1,2,3];
    const paragraphs = ['빵을 구웠어요.','고기를 올렸어요.','둘이 나눴어요.'];
    const scenes = photos.map((photo,i) => ({photo,text:paragraphs[i],evidence:paragraphs[i]}));
    await writeFile(common('post.html'),photos.map((n,i) =>
      '<img class="se-image-resource" src="https://example.com/'+n+'.jpg"><p class="se-text-paragraph">'+paragraphs[i]+'</p>').join(''));
    await writeFile(common('openings.json'),JSON.stringify(scenes.slice(0,2).map((scene,i) =>
      ({title:'이야기 '+i,photo:scene.photo,evidence:scene.evidence}))));
    for (const n of photos) await writeFile(common(n + '.jpg'),Buffer.concat([Buffer.from('P6\n8 8\n255\n'),Buffer.alloc(192,50*n)]));
    for (const id of [0,1]) {
      await mkdir(common('story-' + id));
      await writeFile(local(id,'plan.json'),JSON.stringify({title:'이야기 '+id,scenes}));
      for (const file of ['voice.ready','0.wav','1.wav','2.wav']) await writeFile(local(id,file),'cached');
    }
    function worker(action,id,edit={}) {
      const dir = id == null ? root : common('story-' + id);
      return spawnSync(process.execPath,[engine,'https://blog.naver.com/test/123','-'],{
        env:{...process.env,FFMPEG:ffmpeg,SHORTS_SESSION:dir,SHORTS_SOURCE_DIR:root,SHORTS_STORY:String(id),
          PHOTO_DIR:root,SHORTS_ACTION:action,SHORTS_EDIT:JSON.stringify(edit),DEEPSEEK_API_KEY:''},
        windowsHide:true,encoding:'utf8',
      });
    }
    const ok = result => assert.equal(result.status,0,result.stderr);
    ok(worker('stories'));
    const {candidates} = JSON.parse(await readFile(common('stories.json'),'utf8'));
    assert.deepEqual(candidates.map(c => [c.id,c.hasPlan,Boolean(c.image)]),[[0,true,true],[1,true,true]]);
    ok(worker('story',1));
    const board = JSON.parse(await readFile(local(1,'board.json'),'utf8'));
    assert.deepEqual(board.scenes.map(s => s.text),paragraphs);
    assert.deepEqual(board.scenes[1].context,paragraphs.slice(0,2));
    const edits = {scenes:scenes.map(s => ({photo:s.photo,text:s.text}))};
    edits.scenes[0].photo = 2;
    edits.scenes[1].text = '빵 위에 고기를 올려요.';
    ok(worker('apply',1,edits));
    const revised = JSON.parse(await readFile(local(1,'plan.json'),'utf8'));
    assert.equal(revised.scenes[0].evidencePhoto,1);
    assert.equal(revised.scenes[1].text,edits.scenes[1].text);
    for (const file of ['1.wav','voice.ready']) await assert.rejects(readFile(local(1,file)),{code:'ENOENT'});
    for (const file of ['0.wav','2.wav']) assert.equal(await readFile(local(1,file),'utf8'),'cached');
    assert.deepEqual(JSON.parse(await readFile(local(0,'plan.json'),'utf8')).scenes,scenes);
    assert.equal(await readFile(local(0,'voice.ready'),'utf8'),'cached');
    edits.scenes[2].text = '모든 메뉴가 무료예요.';
    assert.match(worker('apply',1,edits).stderr,/3번째 장면/);
    assert.deepEqual(JSON.parse(await readFile(local(1,'plan.json'),'utf8')),revised);
  });
