import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepSeekPlan} from './deepseek-planner.mjs';

const [source, output = 'shorts.mp4', scriptFile] = process.argv.slice(2);
if (!source) throw Error('node shorts.mjs NAVER_URL [OUTPUT.mp4] [SCRIPT.json]');
if (existsSync(output)) throw Error('Output already exists: ' + output);
const url = new URL(source);
const post = url.pathname.match(/^\/([\w-]+)\/(\d+)\/?$/);
if (!post || !['blog.naver.com','m.blog.naver.com'].includes(url.hostname))
  throw Error('Expected a public Naver Blog post URL.');
const mobile = 'https://m.blog.naver.com/' + post[1] + '/' + post[2];
const dir = mkdtempSync(path.join(tmpdir(), 'blog-shorts-'));
const local = name => path.join(dir, name);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
// Relative filter paths work even when the portable application path contains a drive letter or spaces.
mkdirSync(local('fonts'));
for (const font of ['Pretendard-ExtraBold.otf', 'Pretendard-Bold.otf']) {
  copyFileSync(fileURLToPath(new URL('fonts/' + font, import.meta.url)), local('fonts/' + font));
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
const html = process.env.POST_HTML ? readFileSync(process.env.POST_HTML,'utf8') : (await download(mobile)).toString('utf8');
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
if (scriptFile) {
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
writeFileSync(local('plan.json'),JSON.stringify(plan,null,2));
if (process.env.SHORTS_PLAN_PATH) {
  // Preserve the paid plan even if a later voice or rendering step fails.
  writeFileSync(process.env.SHORTS_PLAN_PATH, JSON.stringify(plan, null, 2), {flag:'wx'});
}
writeFileSync(local('scenes.json'),JSON.stringify(plan.scenes,null,2));
if (process.env.SHORTS_VOICE === 'gemini') {
  const {synthesizeGeminiScenes} = await import('./gemini-voice.mjs');
  await synthesizeGeminiScenes(plan.scenes, dir);
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

function wrap(line,limit) {
  const words = line.split(/\s+/).flatMap(w=>w.match(new RegExp('.{1,'+limit+'}','gu')) || []);
  const rows = [];
  for (const w of words) {
    if (rows.length && (rows.at(-1)+' '+w).length <= limit) rows[rows.length-1]+=' '+w;
    else rows.push(w);
  }
  return rows;
}
function assText(s) {
  // Break literal ASS escape sequences without changing the visible dialogue.
  return s.replaceAll('\\', '\\\u2060').replace(/[{}]/g, char => '\\' + char);
}
function stamp(sec) {
  const cs=Math.floor(sec*100);
  return '0:'+String(Math.floor(cs/6000)).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+'.'+String(cs%100).padStart(2,'0');
}
const assHeader = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 720', 'PlayResY: 1280', 'WrapStyle: 2',
  '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Subject,Pretendard ExtraBold,74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,-1,0,3,6,0,5,20,20,0,1',
  'Style: Hook,Pretendard ExtraBold,74,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,-1,0,1,0,0,5,20,20,0,1',
  'Style: Caption,Pretendard,48,&H00FFFFFF,&H00FFFFFF,&H00121212,&H00121212,-1,0,0,0,100,100,0,0,1,2.6,0,2,25,25,0,1',
  '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text', ''
].join('\n');
const event = (start, end, style, body) => 'Dialogue: 0,' + stamp(start) + ',' + stamp(end) + ',' + style + ',,0,0,0,,' + body + '\n';

function headline(line, style, y, end) {
  // Allow short hooks to fill the header and fit the longest supported Korean titles within its margins.
  const units = Array.from(line).reduce((n, char) => n + (char === ' ' ? 0.35 : 1), 0);
  const size = Math.min(78, Math.floor(660 / Math.max(1, units)));
  return event(0, end, style, '{\\pos(360,' + y + ')\\fs' + size + '}' + assText(line));
}
for (const [i,scene] of plan.scenes.entries()) {
  console.log(`영상 합성 · ${i + 1}/${plan.scenes.length}장면`);
  const cached = process.env.PHOTO_DIR && path.resolve(process.env.PHOTO_DIR,scene.photo+'.jpg');
  if (cached) copyFileSync(cached,local('photo'));
  else writeFileSync(local('photo'),await download(photos[scene.photo-1].src));
  const probe=run(ffmpeg,['-hide_banner','-i',i+'.wav','-f','null','-']).stderr;
  const duration=probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!duration) throw Error('Cannot measure narration duration.');
  const speech=Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]);
  const frames=Math.ceil((speech+0.20)*30);
  const end=frames/30;
  const [subject, ...rest] = plan.title.split('\n').filter(Boolean);
  let ass = assHeader + headline(subject, 'Subject', rest.length ? 177 : 220, end);
  if (rest.length) ass += headline(rest.join(' '), 'Hook', 270, end);
  const rows=wrap(scene.text,15).map(assText);
  const groups=[];
  for(let j=0;j<rows.length;j+=2) groups.push(rows.slice(j,j+2));
  const weight=groups.map(g=>g.join('').length);
  let elapsed=0;
  for (const [k,g] of groups.entries()) {
    const until=elapsed+speech*weight[k]/weight.reduce((a,b)=>a+b,0);
    ass+=event(elapsed,k===groups.length-1?end:until,'Caption','{\\pos(360,930)}'+g.join('\\N'));
    elapsed=until;
  }
  writeFileSync(local('scene.ass'),ass);
  const vf="scale=720:632:force_original_aspect_ratio=increase,crop=720:632,setsar=1,pad=720:1280:0:326:color=white,loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,fps=30,ass=scene.ass:fontsdir=fonts";
  run(ffmpeg,['-loglevel','error','-y','-i','photo','-i',i+'.wav','-vf',vf,'-af','apad','-t',String(end),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',i+'.mp4']);
}
writeFileSync(local('list.txt'),plan.scenes.map((_,i)=>"file '"+i+".mp4'").join('\n'));
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
run(ffmpeg,['-loglevel','error','-f','concat','-safe','0','-i','list.txt','-c','copy','-movflags','+faststart',path.resolve(output)]);
console.log(path.resolve(output));
