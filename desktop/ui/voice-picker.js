import {popularVoices} from './popular-voices.js';
import {createVoiceLibrary, voicePortrait} from './voice-library.js';

const $ = id => document.getElementById(id);

export function createVoicePicker({initial, remember, invoke, convertFileSrc, run, hasKey, askKey}) {
  let applied = initial?.id && initial.model ? initial : null;
  const details = new Map();
  const list = $('voiceList'), player = $('voicePlayer'), text = $('voiceText');
  const library = createVoiceLibrary({appliedId:() => applied?.id, onChange:showCandidate, hasKey, askKey, run,
    async loadAll() {
      const rows = JSON.parse(await request('list'));
      for (const voice of rows) {
        details.set(voice.id, voice);
      }
      return rows;
    },
  });
  const candidate = library.current;
  function summary() {
    $('appliedVoice').textContent = applied ? '영상에 적용 · ' + applied.name : '영상에 사용할 목소리를 골라보세요.';
    const selected = popularVoices.find(v => v.id === applied?.id);
    $('voiceStack').replaceChildren(...(applied ? [selected || applied] : popularVoices.slice(0,3)).map(v => voicePortrait(v)));
    library.updateApplied();
  }
  function select(voice) {
    applied = voice ? {id:voice.id, model:voice.model, name:voice.name} : null;
    summary();
    remember(applied);
  }
  function stop() {
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.hidden = true;
    $('voiceFeedback').textContent = '';
  }
  function buttons() {
    const voice = candidate();
    const detail = details.get(voice?.id);
    $('sampleVoice').disabled = !voice || detail?.previewUrl === '';
    $('previewVoice').disabled = !voice || !text.value.trim();
    const inUse = voice && voice.id === applied?.id && (!detail || detail.models.includes(applied.model));
    $('applyVoice').disabled = !voice || Boolean(inUse);
    $('applyVoice').textContent = inUse ? '영상에 적용됨' : '이 목소리 사용';
    if (detail?.previewUrl === '') $('voiceFeedback').textContent = '공식 샘플이 없습니다. 내 대사로 들어보세요.';
  }
  function showCandidate() {
    stop();
    const voice = candidate();
    $('voiceInspector').hidden = !voice;
    if (voice) {
      $('candidatePortrait').replaceChildren(voicePortrait(voice));
      $('candidateName').textContent = voice.name;
      $('candidateUsage').textContent = [voice.english,voice.usage].filter(Boolean).join(' · ');
    }
    buttons();
  }
  function request(action, params = {}) {
    return invoke('typecast_voice', {request:{action, apiKey:$('typecastKey').value.trim(), ...params}});
  }
  function play(src, label) {
    stop();
    player.src = src;
    player.hidden = false;
    $('voiceFeedback').textContent = label;
    player.play().catch(error => {
      if (error.name === 'AbortError' || player.hidden) return;
      $('voiceFeedback').textContent = error.name === 'NotAllowedError'
        ? '재생 버튼을 눌러 들어보세요.' : '음성을 재생할 수 없습니다. 연결을 확인하거나 내 대사로 다시 들어보세요.';
    });
  }
  function openLibrary() {
    if (!$('voiceLibrary').hidden) return;
    $('voiceLibrary').hidden = false;
    $('loadVoices').setAttribute('aria-expanded','true');
    $('voiceToggleText').textContent = '목록 접기';
    library.draw(applied?.id,true);
  }
  $('loadVoices').onclick = () => {
    if ($('voiceLibrary').hidden) {
      openLibrary();
      $('voiceSearch').focus();
    } else {
      stop();
      $('voiceLibrary').hidden = true;
      $('loadVoices').setAttribute('aria-expanded','false');
      $('voiceToggleText').textContent = '목소리 고르기';
    }
  };
  async function getDetails(id) {
    if (!details.has(id)) details.set(id, JSON.parse(await request('detail', {id})));
    return details.get(id);
  }
  async function useCandidate(message, action) {
    const voice = candidate();
    if (!voice) return;
    if (!hasKey()) return askKey();
    stop();
    await run(voice.name + ' ' + message, async () => {
      const detail = await getDetails(voice.id);
      buttons();
      await action(detail);
    });
  }
  text.oninput = () => { stop(); buttons(); };
  $('applyVoice').onclick = () => useCandidate('목소리를 적용하는 중', voice => {
    select({...voice, model:voice.models[0]});
    buttons();
  });
  $('sampleVoice').onclick = () => useCandidate('공식 샘플을 여는 중', voice => {
    if (voice.previewUrl) play(voice.previewUrl, voice.name + ' · 공식 샘플');
  });
  $('previewVoice').onclick = () => useCandidate('목소리로 대사를 읽는 중', async voice => {
    const model = voice.id === applied?.id && voice.models.includes(applied.model) ? applied.model : voice.models[0];
    const file = await request('preview', {id:voice.id, model, text:text.value.trim()});
    play(convertFileSrc(file), voice.name + ' · 내 대사');
  });
  $('typecastKey').oninput = () => {
    stop();
    details.clear();
    library.clearCatalog();
    buttons();
  };
  summary();
  return {
    async forRender() {
      if (!applied) { openLibrary(); return null; }
      if (!hasKey()) { askKey(); return undefined; }
      const ok = await run('선택한 목소리를 확인하는 중', async () => {
        const voice = await getDetails(applied.id);
        if (!voice.models.includes(applied.model)) {
          openLibrary();
          throw Error('이전에 선택한 음성 모델을 사용할 수 없습니다. 목소리를 다시 적용하세요.');
        }
      });
      return ok ? applied : undefined;
    },
    show(page, firstText) {
      stop();
      if (page !== 'entry' && page !== 'picker') return;
      $(page === 'entry' ? 'entryVoice' : 'pickerVoice').append($('voicePanel'));
      if (page === 'picker' && firstText) text.value = firstText;
      buttons();
    },
    focus() { openLibrary(); (list.querySelector(':checked') || $('voiceSearch')).focus(); },
    stop,
  };
}
