import {popularVoices} from './popular-voices.js';
import {portraitPaths} from './voice-portrait-paths.js';

const $ = id => document.getElementById(id);
const popularById = new Map(popularVoices.map((v, i) => [v.id, i]));
const favoriteKey = 'typecast.voiceFavorites.v1';
const pageSize = 36;
const labels = {popular:'인기 목소리', all:'전체 목소리', favorites:'즐겨찾는 목소리'};

export function voicePortrait(voice, observer) {
  const frame = document.createElement('span');
  const index = popularById.get(voice.id);
  frame.className = 'voice-portrait tone-' + ((index ?? voice.name.charCodeAt(0)) % 4);
  frame.setAttribute('aria-hidden','true');
  frame.textContent = voice.name.slice(0,1);
  const actor = voice.id.slice(3);
  const remote = voice.id.startsWith('tc_') && Object.hasOwn(portraitPaths,actor) && portraitPaths[actor];
  if (index === undefined && !remote) return frame;
  const image = new Image();
  image.alt = '';
  image.draggable = false;
  image.referrerPolicy = 'no-referrer';
  image.onload = () => frame.classList.add('has-image');
  image.onerror = () => image.remove();
  const url = index === undefined ? 'https://static2.typecast.ai' + remote : 'voice-portraits/' + actor + '.webp';
  frame.append(image);
  if (observer) {
    image.dataset.src = url;
    observer.observe(image);
  } else image.src = url;
  return frame;
}

function readFavorites() {
  const rows = JSON.parse(localStorage.getItem(favoriteKey) || '[]');
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.filter(v => typeof v?.id === 'string' && /^(tc|uc)_[a-zA-Z0-9_-]+$/.test(v.id) &&
    typeof v.name === 'string' && v.name && typeof v.english === 'string' && typeof v.usage === 'string')
    .map(v => [v.id, v]));
}

export function createVoiceLibrary({appliedId, onChange, loadAll, hasKey, askKey, run}) {
  const list = $('voiceList'), views = $('voiceViews'), search = $('voiceSearch');
  let favorites = new Map(), catalog, visible = [], view = 'popular', page = 0;
  try { favorites = readFavorites(); } catch {}
  const observer = new IntersectionObserver(entries => {
    for (const {target, isIntersecting} of entries) {
      if (!isIntersecting || !target.isConnected) continue;
      observer.unobserve(target);
      target.src = target.dataset.src;
      delete target.dataset.src;
    }
  });
  function current() {
    const id = list.querySelector(':checked')?.value;
    return visible.find(v => v.id === id);
  }
  function syncStars() {
    $('favoriteCount').textContent = favorites.size;
    for (const star of list.querySelectorAll('.voice-star')) {
      const saved = favorites.has(star.dataset.id);
      star.setAttribute('aria-pressed',String(saved));
      star.title = saved ? '즐겨찾기 해제' : '즐겨찾기 추가';
    }
  }
  function toggleFavorite(voice, button) {
    const notice = $('voiceLibraryNotice');
    try {
      const latest = readFavorites();
      if (latest.has(voice.id)) latest.delete(voice.id);
      else {
        const {id, name, english, usage} = voice;
        latest.set(id, {id, name, english, usage});
      }
      localStorage.setItem(favoriteKey, JSON.stringify([...latest.values()]));
      favorites = latest;
      notice.textContent = '';
    } catch {
      notice.textContent = '즐겨찾기를 저장하지 못했습니다. 다시 시도하세요.';
      return;
    }
    if (view === 'favorites') {
      const position = visible.indexOf(voice), selected = current()?.id;
      const restoreFocus = document.activeElement === button;
      draw(selected);
      if (restoreFocus) (list.querySelectorAll('.voice-star')[Math.min(position,visible.length-1)] ||
        views.querySelector('[aria-pressed=true]')).focus();
    } else syncStars();
  }
  function makeCard(voice, selected) {
    const entry = document.createElement('div'), card = document.createElement('label');
    entry.className = 'voice-entry';
    card.className = 'voice-choice';
    card.classList.toggle('is-applied', voice.id === appliedId());
    const radio = document.createElement('input');
    Object.assign(radio,{type:'radio',name:'auditionVoice',value:voice.id,checked:voice.id === selected});
    const name = document.createElement('strong'), usage = document.createElement('small');
    name.textContent = voice.name;
    usage.textContent = voice.usage || voice.english;
    const badge = document.createElement('span');
    badge.className = 'voice-applied';
    badge.textContent = '적용됨';
    card.append(radio, voicePortrait(voice, view === 'popular' ? null : observer), name, usage, badge);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'voice-star';
    star.dataset.id = voice.id;
    star.setAttribute('aria-label',voice.name + ' 즐겨찾기');
    star.append($('voiceStarIcon').content.cloneNode(true));
    star.onclick = () => toggleFavorite(voice,star);
    entry.append(card,star);
    return entry;
  }
  function draw(preferred = current()?.id, reveal = false) {
    const source = view === 'all' ? [...catalog.values()] : view === 'favorites'
      ? [...favorites.values()].map(v => catalog?.get(v.id) || v) : popularVoices;
    const query = search.value.trim().toLocaleLowerCase();
    const matches = source.filter(v => (v.name + ' ' + v.english).toLocaleLowerCase().includes(query));
    const pages = Math.ceil(matches.length/pageSize);
    const index = reveal ? matches.findIndex(v => v.id === preferred) : -1;
    page = Math.max(0,Math.min(index >= 0 ? Math.floor(index/pageSize) : page,pages-1));
    visible = matches.slice(page*pageSize,(page+1)*pageSize);
    const selected = visible.find(v => v.id === preferred) || visible[0];
    observer.disconnect();
    list.replaceChildren(...visible.map(v => makeCard(v,selected.id)));
    list.hidden = !matches.length;
    list.setAttribute('aria-label',labels[view]);
    $('voiceEmpty').hidden = Boolean(matches.length);
    $('voiceEmpty').textContent = query ? '검색 결과가 없습니다. 다른 이름으로 검색해 보세요.'
      : view === 'favorites' ? '카드의 별을 누르면 여기에 모입니다.' : '이 계정에 사용 가능한 목소리가 없습니다.';
    $('voiceCount').textContent = matches.length + '개';
    $('voicePages').hidden = pages <= 1;
    $('voicePageNumber').textContent = pages ? (page+1) + ' / ' + pages : '';
    $('voicePrev').disabled = page === 0;
    $('voiceNext').disabled = page >= pages-1;
    for (const tab of views.querySelectorAll('button')) tab.setAttribute('aria-pressed',String(tab.dataset.view === view));
    syncStars();
    list.scrollTop = 0;
    const checked = list.querySelector(':checked')?.closest('.voice-entry');
    if (checked && checked.offsetTop + checked.offsetHeight > list.clientHeight) {
      list.scrollTop = checked.offsetTop - list.clientHeight + checked.offsetHeight;
    }
    onChange();
  }
  views.onclick = async event => {
    const next = event.target.closest('button')?.dataset.view;
    if (!next || next === view) return;
    $('voiceLibraryNotice').textContent = '';
    if (next === 'all' && !catalog) {
      if (!hasKey()) return askKey();
      const ok = await run('타입캐스트 전체 목소리를 불러오는 중', async () => {
        const rows = await loadAll();
        catalog = new Map(rows.map(v => [v.id,v]));
      });
      if (!ok) return;
    }
    const preferred = current()?.id || appliedId();
    view = next;
    search.value = '';
    page = 0;
    draw(preferred, true);
  };
  search.oninput = () => { page = 0; draw(); };
  $('voicePrev').onclick = () => { page--; draw(); };
  $('voiceNext').onclick = () => { page++; draw(); };
  list.onchange = onChange;
  list.onkeydown = event => {
    if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    const radios = [...list.querySelectorAll('input')], index = radios.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
    const target = {ArrowUp:index-columns, ArrowDown:index+columns, Home:0, End:radios.length-1}[event.key];
    const next = radios[Math.max(0,Math.min(radios.length-1,target))];
    next.focus();
    next.click();
  };
  window.addEventListener('storage', event => {
    if (event.key !== favoriteKey && event.key !== null) return;
    try { favorites = readFavorites(); } catch { return; }
    if (view === 'favorites') draw(); else syncStars();
  });
  syncStars();
  return {
    current, draw,
    clearCatalog() {
      catalog = undefined;
      if (view === 'all') { view = 'popular'; search.value = ''; page = 0; }
      if (!$('voiceLibrary').hidden) draw();
    },
    updateApplied() {
      for (const radio of list.querySelectorAll('input')) {
        radio.closest('label').classList.toggle('is-applied', radio.value === appliedId());
      }
    },
  };
}
