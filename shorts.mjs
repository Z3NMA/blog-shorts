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
function run(cmd, args) {
  const env = {...process.env};
  delete env.DEEPSEEK_API_KEY;
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
console.log('Photos:',photos.length,'Scenes:',plan.scenes.length,'Working files:',dir);
writeFileSync(local('plan.json'),JSON.stringify(plan,null,2));
if (process.env.SHORTS_PLAN_PATH) {
  // Preserve the paid plan even if a later voice or rendering step fails.
  writeFileSync(process.env.SHORTS_PLAN_PATH, JSON.stringify(plan, null, 2), {flag:'wx'});
}
writeFileSync(local('scenes.json'),JSON.stringify(plan.scenes,null,2));
if (process.env.SHORTS_VOICE === 'deepseek') {
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
function assText(s) { return s.replace(/[{}\\]/g,''); }
function stamp(sec) {
  const cs=Math.floor(sec*100);
  return '0:'+String(Math.floor(cs/6000)).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+'.'+String(cs%100).padStart(2,'0');
}
const assHeader = '[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Main,Malgun Gothic,49,&H00FFFFFF,&H00FFFFFF,&H00312018,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,18,18,0,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n';
const event = (a,b,body) => 'Dialogue: 0,'+stamp(a)+','+stamp(b)+',Main,,0,0,0,,'+body+'\n';
for (const [i,scene] of plan.scenes.entries()) {
  const cached = process.env.PHOTO_DIR && path.resolve(process.env.PHOTO_DIR,scene.photo+'.jpg');
  if (cached) copyFileSync(cached,local('photo'));
  else writeFileSync(local('photo'),await download(photos[scene.photo-1].src));
  const probe=run(ffmpeg,['-hide_banner','-i',i+'.wav','-f','null','-']).stderr;
  const duration=probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!duration) throw Error('Cannot measure narration duration.');
  const speech=Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]);
  const frames=Math.ceil((speech+0.20)*30);
  const end=frames/30;
  const headings=plan.title.split('\n').flatMap(line=>wrap(assText(line),15));
  const heading=headings.map((row,k)=>(k?'\\N{\\c&H41BDFF&}':'')+row).join('');
  let ass=assHeader+event(0,end,'{\\pos(360,130)\\fs62}'+heading);
  const rows=wrap(assText(scene.caption || scene.text),15);
  const groups=[];
  for(let j=0;j<rows.length;j+=2) groups.push(rows.slice(j,j+2));
  const weight=groups.map(g=>g.join('').length);
  let elapsed=0;
  for (const [k,g] of groups.entries()) {
    const until=elapsed+speech*weight[k]/weight.reduce((a,b)=>a+b,0);
    ass+=event(elapsed,k===groups.length-1?end:until,'{\\pos(360,985)}'+g.join('\\N'));
    elapsed=until;
  }
  writeFileSync(local('scene.ass'),ass);
  const vf="scale=720:1024:force_original_aspect_ratio=increase,crop=720:1024,setsar=1,pad=720:1280:0:256:color=0x302119,loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,fps=30,ass=scene.ass";
  run(ffmpeg,['-loglevel','error','-y','-i','photo','-i',i+'.wav','-vf',vf,'-af','apad','-t',String(end),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',i+'.mp4']);
}
writeFileSync(local('list.txt'),plan.scenes.map((_,i)=>"file '"+i+".mp4'").join('\n'));
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
run(ffmpeg,['-loglevel','error','-f','concat','-safe','0','-i','list.txt','-c','copy','-movflags','+faststart',path.resolve(output)]);
console.log(path.resolve(output));
