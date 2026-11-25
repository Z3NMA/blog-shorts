import {createCarousel} from './carousel.js';

const $ = id => document.getElementById(id);
const {invoke, convertFileSrc} = window.__TAURI__.core;
let defaults, preview, working = false, page = 'entry';
let saved = {};
try { saved = JSON.parse(localStorage.getItem('settings') || '{}') || {}; } catch {}
function persist() {
  const settings = {folder: $('folder').value, style: saved.style};
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
function bindBusy(value, rendering = false) {
  working = value;
  $('inputs').disabled = value;
  $('confirm').textContent = value && page === 'entry' ? '확인 중…' : '확인';
  $('create').textContent = rendering ? '제작 중…' : '이 스타일로 제작';
}
function job(url) {
  return {url, apiKey:$('key').value.trim(), geminiKey:$('geminiKey').value.trim(),
    outputFolder:$('folder').value.trim()};
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
    $('ending').value = manifest.ending?.text ?? '';
    $('endingBody').textContent = '앞 대사 · ' + (manifest.ending?.body ?? '');
    togglePhotos(false);
    $('photoChoices').replaceChildren();
    $('result').hidden = true;
  } catch (e) { status('error','미리보기를 준비하지 못했습니다',String(e)); }
  finally {bindBusy(false);}
  if (page === 'picker') $('mode').focus({preventScroll:true});
}
$('confirm').onclick = prepare;
$('url').onkeydown = e => { if(e.key === 'Enter' && !e.isComposing) {e.preventDefault();prepare();} };
$('edit').onclick = () => {show('entry');$('result').hidden = true;$('url').focus();$('url').select();};
$('again').onclick = () => {show('picker');$('result').hidden = true;$('mode').focus();};
async function editPreview(operation, edit) {
  const result = await invoke('prepare', {job:{...job(preview.url), geminiKey:'', token:preview.token,
    operation, edit:JSON.stringify(edit)}});
  const manifest = JSON.parse(result.manifest);
  if (operation === 'apply') {
    Object.assign(preview, manifest, {audioReady:result.audioReady});
    carousel.reset(manifest.styles, saved.style);
  }
  return manifest;
}
async function editing(message, work) {
  if (working) return;
  bindBusy(true);
  status('working',message,'잠시 기다려 주세요.');
  try { await work(); $('result').hidden = true; }
  catch (error) { status('error','편집을 완료하지 못했습니다',String(error)); }
  finally { bindBusy(false); }
}
function markPhoto() {
  for (const button of $('photoChoices').children) {
    button.setAttribute('aria-pressed', String(Number(button.value) === preview.photo));
  }
}
async function loadPhotos() {
  const list = $('photoChoices');
  await editing('본문 사진을 불러오는 중', async () => {
    const {choices,total} = await editPreview('photos',{offset:list.childElementCount});
    for (const {photo,image,used} of choices) {
      const button = document.createElement('button');
      button.type = 'button'; button.value = photo; button.className = 'photo-choice';
      if (image) {
        const thumbnail = new Image(); thumbnail.src = image; thumbnail.alt = '';
        button.append(thumbnail);
      }
      button.append('사진 ' + photo + (!image ? ' · 읽기 실패' : used ? ' · 본문 사용 중' : ''));
      button.disabled = !image;
      button.onclick = () => editing('첫 장면을 갱신하는 중', async () => {
        if (photo !== preview.photo) await editPreview('apply',{photo});
        markPhoto();
        togglePhotos(false);
      }).then(() => $('choosePhoto').focus({preventScroll:true}));
      list.append(button);
    }
    markPhoto();
    $('morePhotos').hidden = list.childElementCount >= total;
  });
}
function togglePhotos(open) {
  $('photoPanel').hidden = !open;
  $('choosePhoto').setAttribute('aria-expanded',String(open));
  $('choosePhoto').textContent = open ? '사진 목록 닫기' : '사진 바꾸기';
}
$('choosePhoto').onclick = async () => {
  const open = $('photoPanel').hidden;
  togglePhotos(open);
  if (open && !$('photoChoices').childElementCount) await loadPhotos();
};
$('morePhotos').onclick = loadPhotos;
$('rewrite').onclick = async () => {
  if (!$('key').value.trim() && !defaults.hasKey) return requireSetting('key','AI로 마지막 멘트를 다시 쓰려면 DeepSeek API 키를 입력하세요.');
  await editing('전체 대본을 읽고 마지막 멘트를 쓰는 중', async () => {
    const {text} = await editPreview('ending',{ending:$('ending').value.trim()});
    $('ending').value = text;
  });
  $('ending').focus({preventScroll:true});
};
$('create').onclick = async () => {
  if (working || !preview) return;
  const data = job(preview.url), style = carousel.selected;
  const ending = $('ending').value.trim();
  if (!ending) {
    status('error','마지막 멘트를 확인하세요','마지막에 읽을 문장을 입력하세요.');
    $('ending').focus(); return;
  }
  const changed = ending !== preview.ending?.text;
  if (!data.geminiKey && !defaults.hasGeminiKey && (!preview.audioReady || changed))
    return requireSetting('geminiKey','내레이션에 사용할 Google AI Studio의 Gemini API 키를 입력하세요.');
  if (!data.outputFolder) return requireSetting('chooseFolder','MP4를 저장할 폴더를 선택하세요.');
  bindBusy(true, true);
  $('settings').open = false;
  persist();
  status('working','숏츠 제작 중',style.name + ' 스타일로 제작합니다.');
  $('result').scrollIntoView({block:'nearest'});
  try {
    if (changed) await editPreview('apply',{ending});
    const file = await invoke('generate',{job:{...data,apiKey:'',token:preview.token,template:style.id}});
    preview.audioReady = true;
    $('file').textContent = file;
    $('player').poster = preview.styles.find(s => s.id === style.id).image;
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
  if (defaults.hasGeminiKey) $('geminiKey').placeholder = '환경 변수 키 사용 중';
  $('folder').value = saved.folder || defaults.outputFolder;
  await window.__TAURI__.event.listen('render-progress',({payload}) => {
    if (working) $('message').textContent = payload;
  });
  bindBusy(false);
} catch(e) {status('error','앱을 시작하지 못했습니다',String(e));}
