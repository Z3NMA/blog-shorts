import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepSeekPlan, setReviewEnding, suggestReviewEnding} from './deepseek-planner.mjs';
import {parseBlogPost} from './blog-post.mjs';

import {templates, sceneAss, sceneArgs} from './video-templates.mjs';

const session = process.env.SHORTS_SESSION;
const action = session ? process.env.SHORTS_ACTION : undefined;
const prepare = ['prepare','photos','ending','apply'].includes(action);
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
  const r = spawnSync(cmd, args, {cwd:dir, encoding:'utf8', windowsHide:true, env});
  if (r.error || r.status !== 0) throw Error(r.error?.message || r.stderr || r.stdout);
  return r;
}
async function download(address) {
  const response = await fetch(address,{headers:{Referer:mobile},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(response.status + ' ' + address);
  return Buffer.from(await response.arrayBuffer());
}
function save(name, data) {
  writeFileSync(local(name + '.tmp'), data);
  renameSync(local(name + '.tmp'), local(name));
}
const cachedPost = session && existsSync(local('post.html'));
const html = cachedPost ? readFileSync(local('post.html'), 'utf8') :
  process.env.POST_HTML ? readFileSync(process.env.POST_HTML,'utf8') : (await download(mobile)).toString('utf8');
if (session && !cachedPost && html.includes('se-image-resource')) save('post.html', html);
const {title, introduction, photos} = parseBlogPost(html);
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
} else if (session && action !== 'prepare') {
  throw Error('블로그 글을 먼저 확인하세요.');
} else if (scriptFile) {
  plan = JSON.parse(readFileSync(scriptFile,'utf8'));
} else if (process.env.SHORTS_PLANNER === 'deepseek') {
  console.log('DeepSeek에서 대본과 사진 순서를 구성하고 있습니다.');
  const cachedStep = name => session && existsSync(local(name)) ? JSON.parse(readFileSync(local(name), 'utf8')) : undefined;
  plan = await createDeepSeekPlan(title, introduction.join(' '), photos, {
    cachedOpening:cachedStep('opening.json'),
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
  if (!existsSync(local(name))) {
    const cached = process.env.PHOTO_DIR && path.resolve(process.env.PHOTO_DIR, scene.photo + '.jpg');
    if (cached) copyFileSync(cached, local(name));
    else save(name, await download(photos[scene.photo - 1].src));
  }
  return local(name);
}
async function checkedPhoto(scene, index) {
  const file = local('photo-' + scene.photo);
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
if (prepare) {
  const first = plan.scenes[0];
  const edit = JSON.parse(process.env.SHORTS_EDIT || '{}');
  const priceSources = plan.scenes.flatMap(scene => {
    const n = scene.evidencePhoto ?? scene.photo;
    return [...(photos[n-2]?.lines ?? introduction), ...photos[n-1].lines];
  });
  const jpeg = file => 'data:image/jpeg;base64,' + readFileSync(file).toString('base64');
  if (action === 'photos') {
    const numbers = photos.flatMap((photo,i) => photo.isCover ? [] : [i+1]);
    const offset = edit.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw Error('사진 목록을 다시 여세요.');
    const choices = [];
    for (const number of numbers.slice(offset, offset + 8)) {
      const thumb = local('thumb-' + number + '.jpg');
      let image = null;
      try {
        if (!existsSync(thumb)) {
          const photo = await scenePhoto({photo:number});
          const temp = thumb + '.tmp.jpg';
          run(ffmpeg, ['-v','error','-xerror','-y','-i',photo,'-frames:v','1','-vf','scale=160:160:force_original_aspect_ratio=decrease','-q:v','5',temp]);
          renameSync(temp, thumb);
        }
        image = jpeg(thumb);
      } catch {
        rmSync(local('photo-' + number), {force:true});
      }
      choices.push({photo:number, image, used:plan.scenes.slice(1).some(s => s.photo === number)});
    }
    save('choices.json',JSON.stringify({choices,total:numbers.length}));
    process.exit(0);
  }
  if (action === 'ending') {
    const text = await suggestReviewEnding(plan, {previous:edit.ending || plan.ending?.text, priceSources});
    save('suggestion.json',JSON.stringify({text}));
    process.exit(0);
  }
  const lastText = plan.scenes.at(-1).text;
  if (action === 'apply') {
    if (edit.photo != null && edit.photo !== first.photo) {
      if (!Number.isInteger(edit.photo) || !photos[edit.photo-1] || photos[edit.photo-1].isCover)
        throw Error('블로그 본문에 있는 첫 사진을 선택하세요.');
      first.evidencePhoto ??= first.photo;
      first.photo = edit.photo;
      if (first.photo === first.evidencePhoto) delete first.evidencePhoto;
    }
    if (edit.ending != null) setReviewEnding(plan, edit.ending, priceSources);
  }
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
    if (lastText !== plan.scenes.at(-1).text) {
      rmSync(local('voice.ready'), {force:true});
      rmSync(local((plan.scenes.length-1) + '.wav'), {force:true});
    }
    save('plan.json',JSON.stringify(plan,null,2));
  }
  save('preview.json', JSON.stringify({title:plan.title, articleTitle:title, styles,
    photo:first.photo, firstText:first.text, ending:plan.ending}));
  process.exit(0);
}
const template = templates.find(t => t.id === (process.env.SHORTS_TEMPLATE || plan.template || 'white'));
if (!template) throw Error('영상 스타일을 다시 선택하세요.');
if (process.env.SHORTS_PLAN_PATH) {
  // Preserve the paid plan even if a later voice or rendering step fails.
  writeFileSync(process.env.SHORTS_PLAN_PATH, JSON.stringify({...plan,template:template.id}, null, 2), {flag:'wx'});
}
writeFileSync(local('scenes.json'),JSON.stringify(plan.scenes,null,2));
const readyPhotos = new Map();
for (const [index, scene] of plan.scenes.entries()) {
  if (readyPhotos.has(scene.photo)) continue;
  console.log(`사진 확인 · ${index + 1}/${plan.scenes.length}장면`);
  readyPhotos.set(scene.photo, await checkedPhoto(scene, index));
}
if (process.env.SHORTS_VOICE === 'gemini') {
  const {synthesizeGeminiScenes} = await import('./gemini-voice.mjs');
  await synthesizeGeminiScenes(plan.scenes, dir, {reuseCompleted:Boolean(session)});
  if (session) save('voice.ready', 'ok');
} else if (process.env.SHORTS_VOICE === 'deepseek') {
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
  const probe=run(ffmpeg,['-hide_banner','-i',i+'.wav','-f','null','-']).stderr;
  const duration=probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!duration) throw Error('Cannot measure narration duration.');
  const speech=Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]);
  const frames=Math.ceil((speech+0.20)*30);
  const end=frames/30;
  writeFileSync(local('scene.ass'),sceneAss(template, plan.title, scene.text, speech, end));
  run(ffmpeg,[...sceneArgs(template, photo, i+'.wav'),'-map','2:a:0','-af','apad','-t',String(end),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',i+'.mp4']);
}
writeFileSync(local('list.txt'),plan.scenes.map((_,i)=>"file '"+i+".mp4'").join('\n'));
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
run(ffmpeg,['-loglevel','error','-f','concat','-safe','0','-i','list.txt','-c','copy','-movflags','+faststart',path.resolve(output)]);
console.log(path.resolve(output));
