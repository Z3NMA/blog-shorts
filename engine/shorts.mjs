import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepSeekPlan, proposeStories, suggestReviewEnding} from './deepseek-planner.mjs';
import {editScenes, sceneSources, sourceLines, videoPlan} from './scene-editor.mjs';
import {parseBlogPost} from './blog-post.mjs';
import {typecastClip, typecastSelection} from './typecast-voice.mjs';

import {templates, sceneAss, sceneArgs} from './video-templates.mjs';

const session = process.env.SHORTS_SESSION;
const action = session ? process.env.SHORTS_ACTION : undefined;
const prepare = ['stories','story','prepare','photos','ending','apply'].includes(action);
const [source, output = 'shorts.mp4', scriptFile] = process.argv.slice(2);
if (!source) throw Error('node shorts.mjs NAVER_URL [OUTPUT.mp4] [SCRIPT.json]');
if (!prepare && existsSync(output)) throw Error('Output already exists: ' + output);
const url = new URL(source);
const post = url.pathname.match(/^\/([\w-]+)\/(\d+)\/?$/);
if (!post || !['blog.naver.com','m.blog.naver.com'].includes(url.hostname))
  throw Error('Expected a public Naver Blog post URL.');
const mobile = 'https://m.blog.naver.com/' + post[1] + '/' + post[2];
const dir = session || mkdtempSync(path.join(tmpdir(), 'blog-shorts-'));
const local = name => path.join(dir, name);
const shared = name => path.join(session && process.env.SHORTS_SOURCE_DIR || dir, name);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
// Relative filter paths work even when the portable application path contains a drive letter or spaces.
mkdirSync(local('fonts'), {recursive:true});
for (const font of ['Pretendard-ExtraBold.otf', 'Pretendard-Bold.otf','GowunBatang-Bold.ttf','Jua-Regular.ttf']) {
  if (!existsSync(local('fonts/' + font))) copyFileSync(fileURLToPath(new URL('fonts/' + font, import.meta.url)), local('fonts/' + font));
}
function run(cmd, args) {
  const env = {...process.env};
  delete env.DEEPSEEK_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.TYPECAST_API_KEY;
  const r = spawnSync(cmd, args, {cwd:dir, encoding:'utf8', windowsHide:true, env});
  if (r.error || r.status !== 0) throw Error(r.error?.message || r.stderr || r.stdout);
  return r;
}
async function download(address) {
  const response = await fetch(address,{headers:{Referer:mobile},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(response.status + ' ' + address);
  return Buffer.from(await response.arrayBuffer());
}
function saveFile(file, data) {
  writeFileSync(file + '.tmp', data);
  renameSync(file + '.tmp', file);
}
const save = (name, data) => saveFile(local(name), data);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const cachedPost = session && existsSync(shared('post.html'));
const html = cachedPost ? readFileSync(shared('post.html'), 'utf8') :
  process.env.POST_HTML ? readFileSync(process.env.POST_HTML,'utf8') : (await download(mobile)).toString('utf8');
if (session && !cachedPost && html.includes('se-image-resource')) saveFile(shared('post.html'), html);
const {title, introduction, photos} = parseBlogPost(html);
const edit = prepare ? JSON.parse(process.env.SHORTS_EDIT || '{}') : {};
const jpeg = file => 'data:image/jpeg;base64,' + readFileSync(file).toString('base64');
if (action === 'stories') {
  const file = shared('openings.json');
  const openings = existsSync(file) ? readJson(file) : await proposeStories(title, introduction.join(' '), photos);
  if (!existsSync(file)) saveFile(file, JSON.stringify(openings));
  const candidates = [];
  for (const [id, opening] of openings.entries()) {
    candidates.push({...opening, id, image:await thumbnail(opening.photo),
      hasPlan:existsSync(shared('story-' + id + '/plan.json'))});
  }
  save('stories.json', JSON.stringify({articleTitle:title, candidates}));
  process.exit(0);
}
function autoPlan() {
  const choices = [];
  for (const [i,photo] of photos.entries()) {
    if (photo.isCover) continue;
    const sentences = photo.lines.flatMap(line => line.split(/(?<=[.!?])\s+/));
    const text = sentences.find(s => s.length >= 13 && s.length <= 90 && /[요다죠네][.!?~ ]*$/.test(s));
    if (text && !choices.some(c => c.text === text)) choices.push({photo:i+1,text});
  }
  if (!choices.length) throw Error('No usable photo captions. Supply a script JSON with photo numbers and text.');
  const count = Math.min(9, choices.length);
  const scenes = Array.from({length:count},(_,i) => choices[Math.round(i*(choices.length-1)/Math.max(1,count-1))]);
  return {title:title.split(/\s+/).slice(0,6).join(' '),scenes};
}
let plan;
const savedPlan = session && existsSync(local('plan.json'));
if (savedPlan) {
  plan = JSON.parse(readFileSync(local('plan.json'), 'utf8'));
} else if (session && action !== 'prepare' && action !== 'story') {
  throw Error('블로그 글을 먼저 확인하세요.');
} else if (scriptFile) {
  plan = JSON.parse(readFileSync(scriptFile,'utf8'));
} else if (process.env.SHORTS_PLANNER === 'deepseek') {
  console.log('DeepSeek에서 대본과 사진 순서를 구성하고 있습니다.');
  const cachedStep = name => session && existsSync(local(name)) ? JSON.parse(readFileSync(local(name), 'utf8')) : undefined;
  let opening;
  if (action === 'story') {
    const id = process.env.SHORTS_STORY;
    opening = /^[0-2]$/u.test(id) && readJson(shared('openings.json'))[Number(id)];
    if (!opening) throw Error('목록에서 이야기를 다시 선택하세요.');
  }
  plan = await createDeepSeekPlan(title, introduction.join(' '), photos, {
    selectedOpening:opening, cachedOpening:cachedStep('opening.json'),
    onOpening:session ? opening => save('opening.json', JSON.stringify(opening)) : undefined,
    cachedDraft:cachedStep('draft.json'),
    onDraft:session ? draft => save('draft.json', JSON.stringify(draft)) : undefined,
  });
} else {
  plan = autoPlan();
}
if (!plan.scenes?.length || !plan.title || plan.scenes.some(s=>!photos[s.photo-1] || !s.text?.trim()))
  throw Error('Invalid title, photo number or narration.');
// Older plans sometimes contain a single headline. Keep its words and split near the middle.
const originalLines = plan.title.trim().split(/\s*\n\s*/u);
if (originalLines.length === 1) {
  const words = originalLines[0].split(/\s+/u);
  if (words.length > 1) {
    const midpoint = originalLines[0].length / 2;
    let split = 1;
    for (let i = 2; i < words.length; i++) {
      if (Math.abs(words.slice(0, i).join(' ').length - midpoint) <
          Math.abs(words.slice(0, split).join(' ').length - midpoint)) split = i;
    }
    plan.title = words.slice(0, split).join(' ') + '\n' + words.slice(split).join(' ');
  }
}
// Older saved plans can include a separately summarized subtitle.
for (const scene of plan.scenes) delete scene.caption;
console.log('Photos:',photos.length,'Scenes:',plan.scenes.length,'Working files:',dir);
if (!savedPlan) save('plan.json',JSON.stringify(plan,null,2));
async function scenePhoto(scene) {
  const name = 'photo-' + scene.photo;
  if (!existsSync(shared(name))) {
    const cached = process.env.PHOTO_DIR && path.resolve(process.env.PHOTO_DIR, scene.photo + '.jpg');
    if (cached) copyFileSync(cached, shared(name));
    else saveFile(shared(name), await download(photos[scene.photo - 1].src));
  }
  return shared(name);
}
async function checkedPhoto(scene, index) {
  const file = shared('photo-' + scene.photo);
  const cached = existsSync(file);
  const decode = async () => {
    await scenePhoto(scene);
    run(ffmpeg, ['-v','error','-xerror','-abort_on','empty_output','-i',file,
      '-map','0:v:0','-frames:v','1','-f','null','-']);
  };
  try {
    try { await decode(); }
    catch (error) {
      if (!cached) throw error;
      rmSync(file, {force:true});
      await decode();
    }
  } catch (error) {
    rmSync(file, {force:true});
    throw Error(`${index + 1}번째 장면의 본문 사진 ${scene.photo}번을 읽을 수 없습니다. 원본 사진과 연결 상태를 확인하고 다시 시도하세요.`, {cause:error});
  }
  return file;
}
async function thumbnail(number) {
  const file = shared('thumb-' + number + '.jpg');
  try {
    if (!existsSync(file)) {
      const photo = await scenePhoto({photo:number});
      const temp = file + '.tmp.jpg';
      run(ffmpeg, ['-v','error','-xerror','-y','-i',photo,'-frames:v','1','-vf',
        'scale=320:240:force_original_aspect_ratio=decrease','-q:v','4',temp]);
      renameSync(temp, file);
    }
    return jpeg(file);
  } catch {
    rmSync(shared('photo-' + number), {force:true});
    return null;
  }
}

async function photoCard(number) {
  return {photo:number, image:await thumbnail(number), context:sourceLines(photos, introduction, number)};
}

if (prepare) {
  if (action === 'story') {
    const scenes = [];
    const last = plan.scenes.at(-1);
    for (const scene of plan.scenes) {
      scenes.push({...await photoCard(scene.photo), evidence:scene.evidence,
        evidencePhoto:scene.evidencePhoto ?? scene.photo,
        excluded:Boolean(scene.excluded), text:scene === last && plan.ending ? plan.ending.body : scene.text});
    }
    save('board.json', JSON.stringify({title:plan.title, articleTitle:title, scenes, ending:plan.ending}));
    process.exit(0);
  }
  if (action === 'photos') {
    const numbers = photos.flatMap((photo,i) => photo.isCover ? [] : [i+1]);
    const offset = edit.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw Error('사진 목록을 다시 여세요.');
    const choices = [];
    for (const number of numbers.slice(offset, offset + 8)) {
      choices.push(await photoCard(number));
    }
    save('choices.json',JSON.stringify({choices,total:numbers.length}));
    process.exit(0);
  }
  if (action === 'ending') {
    const current = videoPlan(editScenes(plan, edit, photos, introduction, {suggesting:true}));
    const priceSources = current.scenes.flatMap(scene => sceneSources(scene, photos, introduction));
    const text = await suggestReviewEnding(current, {previous:edit.ending || plan.ending?.text, priceSources});
    save('suggestion.json',JSON.stringify({text}));
    process.exit(0);
  }
  const original = videoPlan(plan);
  const edited = action === 'apply' ? editScenes(plan, edit, photos, introduction) : plan;
  plan = videoPlan(edited);
  const first = plan.scenes[0];
  const previous = existsSync(local('preview.json')) ? JSON.parse(readFileSync(local('preview.json'),'utf8')) : {};
  let styles = previous.styles;
  if (!styles || first.photo !== previous.photo || first.text !== previous.firstText || plan.title !== previous.title) {
    const photo = await checkedPhoto(first, 0);
    styles = [];
    for (const template of templates) {
      console.log('미리보기 · ' + template.name);
      const poster = local('preview-' + template.id + '.jpg');
      writeFileSync(local('scene.ass'),sceneAss(template, plan.title, first.text, 4, 4));
      run(ffmpeg, [...sceneArgs(template, photo), '-frames:v','1','-q:v','3',poster]);
      styles.push({id:template.id, name:template.name, image:jpeg(poster)});
    }
  }
  if (action === 'apply') {
    for (let index = 0; index < Math.max(original.scenes.length, plan.scenes.length); index++) {
      const changedEnding = (index === plan.scenes.length - 1) !== (index === original.scenes.length - 1);
      if (changedEnding || plan.scenes[index]?.text !== original.scenes[index]?.text) {
        rmSync(local('voice.ready'), {force:true});
        rmSync(local(index + '.wav'), {force:true});
      }
    }
    save('plan.json',JSON.stringify(edited,null,2));
  }
  save('preview.json', JSON.stringify({title:plan.title, articleTitle:title, styles,
    photo:first.photo, firstText:first.text, ending:plan.ending}));
  process.exit(0);
}
plan = videoPlan(plan);
const template = templates.find(t => t.id === (process.env.SHORTS_TEMPLATE || plan.template || 'white'));
if (!template) throw Error('영상 스타일을 다시 선택하세요.');
const provider = process.env.SHORTS_VOICE || plan.narration?.provider;
let voice;
if (provider === 'typecast') {
  voice = typecastSelection(process.env.TYPECAST_VOICE_ID || plan.narration?.id,
    process.env.TYPECAST_MODEL || plan.narration?.model);
}
if (process.env.SHORTS_PLAN_PATH) {
  // Preserve the paid plan even if a later voice or rendering step fails.
  const exported = {...plan,template:template.id};
  if (voice) exported.narration = {provider, ...voice};
  else delete exported.narration;
  writeFileSync(process.env.SHORTS_PLAN_PATH, JSON.stringify(exported, null, 2), {flag:'wx'});
}
writeFileSync(local('scenes.json'),JSON.stringify(plan.scenes,null,2));
const readyPhotos = new Map();
for (const [index, scene] of plan.scenes.entries()) {
  if (readyPhotos.has(scene.photo)) continue;
  console.log(`사진 확인 · ${index + 1}/${plan.scenes.length}장면`);
  readyPhotos.set(scene.photo, await checkedPhoto(scene, index));
}
const audioFiles = plan.scenes.map((_, i) => i + '.wav');
if (voice) {
  const cache = process.env.SHORTS_TYPECAST_CACHE || local('typecast');
  for (const [index, scene] of plan.scenes.entries()) {
    console.log(`타입캐스트 음성 · ${index + 1}/${plan.scenes.length}장면`);
    audioFiles[index] = await typecastClip(scene.text, voice, cache);
  }
} else if (provider === 'gemini') {
  const {synthesizeGeminiScenes} = await import('./gemini-voice.mjs');
  await synthesizeGeminiScenes(plan.scenes, dir, {reuseCompleted:Boolean(session)});
  if (session) save('voice.ready', 'ok');
} else if (provider === 'deepseek') {
  const {synthesizeDeepSeekScenes} = await import('./deepseek-voice.mjs');
  await synthesizeDeepSeekScenes(plan.scenes, dir);
} else if (process.env.SUPERTONIC_MODEL) {
  run(process.env.SHORTS_PYTHON || 'python', [
    fileURLToPath(new URL('voice_ai.py',import.meta.url)),local('scenes.json'),dir,
    path.resolve(process.env.SUPERTONIC_MODEL)
  ]);
} else {
  run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('voice.ps1',import.meta.url)),local('scenes.json'),dir]);
}

for (const [i,scene] of plan.scenes.entries()) {
  console.log(`영상 합성 · ${i + 1}/${plan.scenes.length}장면`);
  const photo = readyPhotos.get(scene.photo);
  const probe=run(ffmpeg,['-hide_banner','-i',audioFiles[i],'-f','null','-']).stderr;
  const duration=probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!duration) throw Error('Cannot measure narration duration.');
  const speech=Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]);
  const frames=Math.ceil((speech+0.20)*30);
  const end=frames/30;
  writeFileSync(local('scene.ass'),sceneAss(template, plan.title, scene.text, speech, end));
  run(ffmpeg,[...sceneArgs(template, photo, audioFiles[i]),'-map','2:a:0','-af','apad','-t',String(end),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',i+'.mp4']);
}
writeFileSync(local('list.txt'),plan.scenes.map((_,i)=>"file '"+i+".mp4'").join('\n'));
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
run(ffmpeg,['-loglevel','error','-f','concat','-safe','0','-i','list.txt','-c','copy','-movflags','+faststart',path.resolve(output)]);
console.log(path.resolve(output));
