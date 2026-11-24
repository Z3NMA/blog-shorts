import {createCarousel} from './carousel.js';

const $ = id => document.getElementById(id);
const {invoke, convertFileSrc} = window.__TAURI__.core;
let defaults, preview, working = false, page = 'entry';
let saved = {};
try { saved = JSON.parse(localStorage.getItem('settings') || '{}') || {}; } catch {}
function persist() {
  const settings = {folder: $('folder').value, style: saved.style};
  if ($('ffmpeg').value !== defaults.ffmpeg) settings.ffmpeg = $('ffmpeg').value;
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {}
}
const controls = ['deck','gallery','mode','modeName','arrows','prev','next','styleName','count','create','picker'];
const carousel = createCarousel(Object.fromEntries(controls.map(id => [id,$(id)])), id => {
  saved.style = id;
  persist();
});
function show(next) {
  page = next;
  for (const id of ['entry','picker','finished']) $(id).hidden = id !== page;
  $('sourceRow').hidden = page === 'entry';
  if (page !== 'finished') { $('player').pause(); $('player').removeAttribute('src'); $('player').load(); }
  if (page === 'picker') carousel.refresh();
}
function status(kind, heading, body) {
  $('result').hidden = false;
  $('result').dataset.kind = kind;
  $('state').textContent = heading;
  $('message').textContent = body;
}
function requireSetting(id, message) {
  $('settings').open = true;
  $(id).focus();
  status('error','설정을 확인하세요', message);
}
function bindBusy(value) {
  working = value;
  $('inputs').disabled = value;
  $('confirm').textContent = value && page === 'entry' ? '확인 중…' : '확인';
  $('create').textContent = value && page === 'picker' ? '제작 중…' : '이 스타일로 제작';
}
function job(url) {
  return {url, apiKey:$('key').value.trim(), geminiKey:$('geminiKey').value.trim(),
    ffmpeg:$('ffmpeg').value.trim(), outputFolder:$('folder').value.trim()};
}
function postUrl(value) {
  const u = new URL(value.trim());
  if (u.protocol !== 'https:' || u.port || u.username || u.password ||
      !['blog.naver.com','m.blog.naver.com'].includes(u.hostname) ||
      !/^\/[\w-]+\/\d+\/?$/.test(u.pathname)) throw Error('invalid');
  return 'https://blog.naver.com' + u.pathname.replace(/\/$/,'');
}
async function prepare() {
  if (working || !defaults) return;
  let url;
  try { url = postUrl($('url').value); } catch {
    status('error','글 주소를 확인하세요','아이디와 글 번호가 포함된 공개 네이버 블로그 주소를 입력하세요.');
    $('url').focus(); return;
  }
  const data = job(url);
  if (!data.apiKey && !defaults.hasKey && url !== preview?.url)
    return requireSetting('key','글 확인에 사용할 DeepSeek API 키를 입력하세요.');
  if (!data.ffmpeg) return requireSetting('ffmpeg','FFmpeg 실행 경로를 입력하세요.');
  bindBusy(true);
  persist();
  status('working','미리보기 준비 중','블로그 사진과 본문을 읽고 있습니다.');
  try {
    const result = await invoke('prepare',{job:{...data, geminiKey:''}});
    const manifest = JSON.parse(result.manifest);
    preview = {url, token:result.token, audioReady:result.audioReady, ...manifest};
    $('article').textContent = manifest.articleTitle;
    $('settings').open = false;
    show('picker');
    carousel.reset(manifest.styles, saved.style || 'white');
    $('result').hidden = true;
  } catch (e) { status('error','미리보기를 준비하지 못했습니다',String(e)); }
  finally {bindBusy(false);}
  if (page === 'picker') $('mode').focus({preventScroll:true});
}
$('confirm').onclick = prepare;
$('url').onkeydown = e => { if(e.key === 'Enter' && !e.isComposing) {e.preventDefault();prepare();} };
$('edit').onclick = () => {show('entry');$('result').hidden = true;$('url').focus();$('url').select();};
$('again').onclick = () => {show('picker');$('result').hidden = true;$('mode').focus();};
$('create').onclick = async () => {
  if (working || !preview) return;
  const data = job(preview.url), style = carousel.selected;
  if (!data.geminiKey && !defaults.hasGeminiKey && !preview.audioReady)
    return requireSetting('geminiKey','내레이션에 사용할 Google AI Studio의 Gemini API 키를 입력하세요.');
  if (!data.outputFolder) return requireSetting('folder','완성 MP4를 저장할 폴더의 전체 경로를 입력하세요.');
  if (!data.ffmpeg) return requireSetting('ffmpeg','FFmpeg 실행 경로를 입력하세요.');
  bindBusy(true);
  $('settings').open = false;
  persist();
  status('working','숏츠 제작 중',style.name + ' 스타일로 제작합니다.');
  $('result').scrollIntoView({block:'nearest'});
  try {
    const file = await invoke('generate',{job:{...data,apiKey:'',token:preview.token,template:style.id}});
    preview.audioReady = true;
    $('doneStyle').textContent = style.name;
    $('file').textContent = file;
    $('player').poster = style.image;
    $('player').src = convertFileSrc(file);
    show('finished');
    $('result').hidden = true;
    window.scrollTo(0,0);
  } catch(e) {status('error','영상을 완성하지 못했습니다',String(e));}
  finally {bindBusy(false);}
};
$('open').onclick = async () => {
  try {await invoke('open_output');} catch(e) {status('error','저장 폴더 열기 실패',String(e));}
};
try {
  defaults = await invoke('defaults');
  if (defaults.hasKey) $('key').placeholder = '환경 변수 키 사용 중';
  if (defaults.hasGeminiKey) $('geminiKey').placeholder = '환경 변수 키 사용 중';
  $('folder').value = saved.folder || defaults.outputFolder;
  $('ffmpeg').value = saved.ffmpeg || defaults.ffmpeg;
  await window.__TAURI__.event.listen('render-progress',({payload}) => {
    if (working) $('message').textContent = payload;
  });
  bindBusy(false);
} catch(e) {status('error','앱을 시작하지 못했습니다',String(e));}
