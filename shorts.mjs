import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepSeekPlan} from './deepseek-planner.mjs';

import {templates, sceneAss, sceneArgs} from './video-templates.mjs';

const session = process.env.SHORTS_SESSION;
const prepare = process.env.SHORTS_ACTION === 'prepare' && Boolean(session);
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
const clean = s => s.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
function save(name, data) {
  writeFileSync(local(name + '.tmp'), data);
  renameSync(local(name + '.tmp'), local(name));
}
const cachedPost = session && existsSync(local('post.html'));
const html = cachedPost ? readFileSync(local('post.html'), 'utf8') :
  process.env.POST_HTML ? readFileSync(process.env.POST_HTML,'utf8') : (await download(mobile)).toString('utf8');
if (session && !cachedPost && html.includes('se-image-resource')) save('post.html', html);
const title = clean(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || '블로그 이야기');
const photos = [];
const introduction = [];
for (const m of html.matchAll(/<img\b[^>]*se-image-resource[^>]*>|<p\b[^>]*se-text-paragraph[^>]*>[\s\S]*?<\/p>/g)) {
  if (m[0].startsWith('<img')) {
    const src = (m[0].match(/data-lazy-src="([^"]+)"/) || m[0].match(/src="([^"]+)"/))?.[1];
    if (src) photos.push({src:clean(src),lines:[]});
  } else {
    const lines = photos.length ? photos.at(-1).lines : introduction;
    lines.push(clean(m[0]));
  }
}
function autoPlan() {
  const choices = [];
  for (const [i,photo] of photos.entries()) {
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
if (session && existsSync(local('plan.json'))) {
  plan = JSON.parse(readFileSync(local('plan.json'), 'utf8'));
} else if (session && !prepare) {
  throw Error('블로그 글을 먼저 확인하세요.');
} else if (scriptFile) {
  plan = JSON.parse(readFileSync(scriptFile,'utf8'));
} else if (process.env.SHORTS_PLANNER === 'deepseek') {
  console.log('DeepSeek에서 대본과 사진 순서를 구성하고 있습니다.');
  plan = await createDeepSeekPlan(title, introduction.join(' '), photos);
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
save('plan.json',JSON.stringify(plan,null,2));
async function scenePhoto(scene) {
  const name = 'photo-' + scene.photo;
  if (!existsSync(local(name))) {
    const cached = process.env.PHOTO_DIR && path.resolve(process.env.PHOTO_DIR, scene.photo + '.jpg');
    if (cached) copyFileSync(cached, local(name));
    else save(name, await download(photos[scene.photo - 1].src));
  }
  return local(name);
}
if (prepare) {
  const first = plan.scenes[0];
  const photo = await scenePhoto(first);
  const styles = [];
  for (const template of templates) {
    console.log('미리보기 · ' + template.name);
    const poster = local('preview-' + template.id + '.jpg');
    writeFileSync(local('scene.ass'),sceneAss(template, plan.title, first.text, 4, 4));
    run(ffmpeg, [...sceneArgs(template, photo), '-frames:v','1','-q:v','3',poster]);
    styles.push({id:template.id, name:template.name, image:'data:image/jpeg;base64,' + readFileSync(poster).toString('base64')});
  }
  save('preview.json', JSON.stringify({title:plan.title, articleTitle:title, styles}));
  process.exit(0);
}
const template = templates.find(t => t.id === (process.env.SHORTS_TEMPLATE || plan.template || 'white'));
if (!template) throw Error('영상 스타일을 다시 선택하세요.');
if (process.env.SHORTS_PLAN_PATH) {
  // Preserve the paid plan even if a later voice or rendering step fails.
  writeFileSync(process.env.SHORTS_PLAN_PATH, JSON.stringify({...plan,template:template.id}, null, 2), {flag:'wx'});
}
writeFileSync(local('scenes.json'),JSON.stringify(plan.scenes,null,2));
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
  const photo = await scenePhoto(scene);
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
