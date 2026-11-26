import {createCarousel} from './carousel.js';
import {createSceneBoard} from './scene-board.js';
import {createVoicePicker} from './voice-picker.js';
import {initWindowControls} from './window-controls.js';

const $ = id => document.getElementById(id);
initWindowControls(error => status('error','창을 조작하지 못했습니다',String(error)));
const {invoke, convertFileSrc} = window.__TAURI__.core;
let defaults, preview, working = false, page = 'entry';
let saved = {};
try { saved = JSON.parse(localStorage.getItem('settings') || '{}') || {}; } catch {}
function persist() {
  const settings = {folder: $('folder').value, style: saved.style, voice:saved.voice};
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {}
}
const controls = ['deck','gallery','mode','modeName','arrows','prev','next','styleName','count','create','picker'];
const carousel = createCarousel(Object.fromEntries(controls.map(id => [id,$(id)])), id => {
  saved.style = id;
  persist();
});
const voices = createVoicePicker({initial:saved.voice, invoke, convertFileSrc, run:editing,
  remember:voice => {saved.voice = voice; persist();},
  hasKey:() => Boolean($('typecastKey').value.trim() || defaults?.hasTypecastKey),
  askKey:() => requireSetting('typecastKey','전체 목록 조회와 미리 듣기, 영상 적용에 사용할 타입캐스트 API 키를 입력하세요.'),
});
function show(next) {
  page = next;
  voices.show(page, preview?.firstText);
  for (const id of ['entry','stories','review','picker','finished']) $(id).hidden = id !== page;
  $('workspace').scrollTop = 0;
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
function bindBusy(value, rendering = false) {
  working = value;
  $('inputs').disabled = value;
  $('inputs').setAttribute('aria-busy', String(value));
  $('confirm').textContent = value && page === 'entry' ? '확인 중…' : '확인';
  $('create').textContent = rendering ? '제작 중…' : '이 스타일로 제작';
}
function job(url) {
  return {url, apiKey:$('key').value.trim(),
    outputFolder:$('folder').value.trim()};
}
function postUrl(value) {
  const u = new URL(value.trim());
  if (u.protocol !== 'https:' || u.port || u.username || u.password ||
      !['blog.naver.com','m.blog.naver.com'].includes(u.hostname) ||
      !/^\/[\w-]+\/\d+\/?$/.test(u.pathname)) throw Error('invalid');
  return 'https://blog.naver.com' + u.pathname.replace(/\/$/,'');
}
const drafts = new Map();
let selectedStory = 0, boardToken;
const board = createSceneBoard({
  loadPhotos:offset => requestEdit('photos', {offset}),
  rewrite:rewriteEnding, run:editing,
});

async function editing(message, work) {
  if (working) return false;
  bindBusy(true);
  status('working', message, '잠시 기다려 주세요.');
  try {
    await work();
    $('result').hidden = true;
    return true;
  } catch (error) {
    status('error', '작업을 완료하지 못했습니다', String(error).replace(/^Error:\s*/, ''));
    $('result').scrollIntoView({block:'nearest'});
    return false;
  } finally { bindBusy(false); }
}

async function requestEdit(operation, edit = {}) {
  const result = await invoke('prepare', {job:{...job(preview.url), token:preview.token,
    operation, story:selectedStory, edit:JSON.stringify(edit)}});
  return JSON.parse(result.manifest);
}

function storyList() {
  const nodes = preview.candidates.map(candidate => {
    const label = document.createElement('label');
    label.className = 'story-choice';
    const input = document.createElement('input');
    Object.assign(input, {type:'radio', name:'story', value:String(candidate.id), checked:candidate.id === selectedStory});
    input.onchange = () => { selectedStory = candidate.id; storyButton(); };
    const media = document.createElement('span');
    media.className = 'story-photo';
    if (candidate.image) {
      const image = new Image();
      image.alt = '첫 사진 ' + candidate.photo;
      image.src = candidate.image;
      media.append(image);
    } else media.textContent = '사진 미리보기 없음';
    const copy = document.createElement('span');
    copy.className = 'story-copy';
    const title = document.createElement('strong'), evidence = document.createElement('span');
    title.textContent = candidate.title.replaceAll('\n', ' ');
    evidence.textContent = '“' + candidate.evidence + '”';
    const meta = document.createElement('small');
    meta.textContent = '첫 사진 ' + candidate.photo + (candidate.hasPlan ? ' · 작성된 대본' : '');
    copy.append(title, evidence, meta);
    label.append(input, media, copy);
    return label;
  });
  $('storyChoices').replaceChildren(...nodes);
  storyButton();
}
function storyButton() {
  $('writeStory').textContent = preview.candidates.find(c => c.id === selectedStory)?.hasPlan
    ? '이 대본 열기' : '이 이야기로 대본 만들기';
}
function openBoard() {
  board.show(drafts.get(selectedStory), boardToken !== preview.token);
  boardToken = preview.token;
  show('review');
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
    return requireSetting('key','이야기 후보를 만들려면 DeepSeek API 키를 입력하세요.');
  const ok = await editing('블로그에서 이야기 후보를 찾는 중', async () => {
    const result = await invoke('prepare',{job:{...data, operation:'stories'}});
    if (result.token !== preview?.token) { drafts.clear(); selectedStory = 0; }
    preview = {url, token:result.token, ...JSON.parse(result.manifest)};
    $('article').textContent = preview.articleTitle;
    $('settings').open = false;
    persist();
    storyList();
    show('stories');
  });
  if (ok) $('storiesTitle').focus();
}
$('confirm').onclick = prepare;
$('url').onkeydown = e => { if(e.key === 'Enter' && !e.isComposing) {e.preventDefault();prepare();} };
$('edit').onclick = () => {show('entry');$('result').hidden = true;$('url').focus();$('url').select();};
$('writeStory').onclick = async () => {
  const candidate = preview.candidates.find(c => c.id === selectedStory);
  if (!candidate.hasPlan && !$('key').value.trim() && !defaults.hasKey)
    return requireSetting('key','선택한 이야기의 대본을 쓰려면 DeepSeek API 키를 입력하세요.');
  const ok = await editing(candidate.hasPlan ? '장면을 여는 중' : '선택한 이야기로 장면별 대본을 쓰는 중', async () => {
    if (!drafts.has(selectedStory)) drafts.set(selectedStory, await requestEdit('story'));
    candidate.hasPlan = true;
    openBoard();
  });
  if (ok) $('reviewTitle').focus();
};
$('backStories').onclick = () => {
  storyList(); show('stories'); $('result').hidden = true;
  $('storyChoices').querySelector(':checked')?.focus();
};
async function rewriteEnding() {
  if (!$('key').value.trim() && !defaults.hasKey)
    return requireSetting('key','AI로 마지막 멘트를 다시 쓰려면 DeepSeek API 키를 입력하세요.');
  const edit = board.edits(true);
  if (!edit) return;
  const ok = await editing('수정한 대본으로 마지막 멘트를 쓰는 중', async () => {
    const {text} = await requestEdit('ending', edit);
    board.setEnding(text);
  });
  if (ok) $('ending').focus({preventScroll:true});
}
$('toStyles').onclick = async () => {
  const edit = board.edits();
  if (!edit) return;
  const ok = await editing('편집한 첫 장면으로 스타일을 준비하는 중', async () => {
    const manifest = await requestEdit('apply', edit);
    Object.assign(preview, manifest);
    const draft = drafts.get(selectedStory);
    draft.scenes.forEach((scene, i) => {scene.text = edit.scenes[i].text;});
    if (manifest.ending) {
      draft.ending = {...manifest.ending};
      draft.scenes.at(-1).text = draft.ending.body;
    }
    show('picker');
    carousel.reset(manifest.styles, saved.style || 'white');
  });
  if (ok) $('mode').focus({preventScroll:true});
};
$('backReview').onclick = () => {openBoard(); $('result').hidden = true; $('reviewTitle').focus();};
$('again').onclick = () => {show('picker');$('result').hidden = true;$('mode').focus();};
$('create').onclick = async () => {
  if (working || !preview) return;
  const data = job(preview.url), style = carousel.selected;
  const voice = await voices.forRender();
  if (voice === undefined) return;
  if (!voice) {
    status('error','내레이션 목소리를 선택하세요','목소리를 고른 뒤 ‘이 목소리 사용’을 누르세요.');
    voices.focus();
    return;
  }
  if (!data.outputFolder) return requireSetting('chooseFolder','MP4를 저장할 폴더를 선택하세요.');
  bindBusy(true, true);
  voices.stop();
  $('settings').open = false;
  persist();
  status('working','숏츠 제작 중',style.name + ' 스타일과 ' + voice.name + ' 목소리로 제작합니다.');
  $('result').scrollIntoView({block:'nearest'});
  try {
    const file = await invoke('generate',{job:{...data,apiKey:'',typecastKey:$('typecastKey').value.trim(),
      voiceId:voice.id,voiceModel:voice.model,token:preview.token,story:selectedStory,template:style.id}});
    $('file').textContent = file;
    $('player').poster = preview.styles.find(s => s.id === style.id).image;
    $('player').src = convertFileSrc(file);
    show('finished');
    $('result').hidden = true;
  } catch(e) {status('error','영상을 완성하지 못했습니다',String(e));}
  finally {bindBusy(false);}
};
$('open').onclick = async () => {
  try {await invoke('open_output');} catch(e) {status('error','저장 폴더 열기 실패',String(e));}
};
$('folder').addEventListener('change', persist);
$('chooseFolder').onclick = async () => {
  const button = $('chooseFolder');
  button.disabled = true;
  try {
    const folder = await invoke('choose_folder', {current: $('folder').value.trim()});
    if (folder) {
      $('folder').value = folder;
      persist();
    }
  } catch (error) {
    status('error', '폴더 선택 실패', String(error));
  } finally {
    button.disabled = false;
  }
};
try {
  defaults = await invoke('defaults');
  if (defaults.hasKey) $('key').placeholder = '환경 변수 키 사용 중';
  if (defaults.hasTypecastKey) $('typecastKey').placeholder = '환경 변수 키 사용 중';
  $('folder').value = saved.folder || defaults.outputFolder;
  await window.__TAURI__.event.listen('render-progress',({payload}) => {
    if (working) $('message').textContent = payload;
  });
  bindBusy(false);
} catch(e) {status('error','앱을 시작하지 못했습니다',String(e));}
