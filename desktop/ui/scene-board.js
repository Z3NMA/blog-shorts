const $ = id => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function photoImage(photo) {
  if (!photo.image) return element('span', 'missing-photo', '사진을 불러오지 못했어요');
  const image = new Image();
  image.src = photo.image;
  image.alt = '본문 사진 ' + photo.photo;
  return image;
}

export function createSceneBoard({loadPhotos, rewrite, run}) {
  let board, active = null, library = [], total = 0;
  function closePhotos(focus = false) {
    if (active === null) return;
    const trigger = $('replace-' + active);
    $('photoPanel').hidden = true;
    $('review').append($('photoPanel'));
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
    active = null;
  }
  function displayPhoto(index) {
    const scene = board.scenes[index];
    $('photo-' + index).replaceChildren(photoImage(scene));
    $('number-' + index).textContent = '본문 사진 ' + scene.photo;
    const context = $('context-' + index);
    context.textContent = scene.context?.filter(Boolean).join('\n') || '사진 주변에 본문이 없습니다.';
  }
  function showPhotos() {
    const choices = library.map(photo => {
      const selected = board.scenes[active].photo === photo.photo;
      const used = board.scenes.some((s, i) => i !== active && !s.excluded && s.photo === photo.photo);
      const button = element('button', 'photo-choice');
      button.type = 'button';
      button.disabled = !photo.image;
      button.setAttribute('aria-pressed', String(selected));
      button.append(photoImage(photo), element('span', '', '사진 ' + photo.photo +
        (selected ? ' · 선택됨' : used ? ' · 사용 중' : '')));
      button.onclick = () => {
        Object.assign(board.scenes[active], photo);
        displayPhoto(active);
        closePhotos(true);
      };
      return button;
    });
    $('photoChoices').replaceChildren(...choices);
    $('retryPhotos').hidden = !library.some(photo => !photo.image);
    $('morePhotos').hidden = library.length >= total && library.length > 0;
    $('morePhotos').textContent = library.length ? '사진 더 보기' : '사진 불러오기';
  }
  async function morePhotos() {
    const offset = library.length;
    const ok = await run('본문 사진을 불러오는 중', async () => {
      const page = await loadPhotos(offset);
      library.push(...page.choices);
      total = page.total;
      showPhotos();
    });
    if (ok) $('photoChoices').children[offset]?.focus({preventScroll:true});
  }
  async function openPhotos(index) {
    if (active === index) return closePhotos(true);
    closePhotos();
    active = index;
    $('photoHeading').textContent = '장면 ' + (index + 1) + '에 쓸 사진';
    $('replace-' + index).setAttribute('aria-expanded', 'true');
    $('row-' + index).append($('photoPanel'));
    $('photoPanel').hidden = false;
    showPhotos();
    if (!library.length) await morePhotos();
    else $('closePhotos').focus({preventScroll:true});
  }
  $('closePhotos').onclick = () => closePhotos(true);
  $('morePhotos').onclick = morePhotos;
  $('retryPhotos').onclick = () => run('사진을 다시 불러오는 중', async () => {
    for (let offset = 0; offset < library.length; offset += 8) {
      if (library.slice(offset, offset + 8).every(photo => photo.image)) continue;
      const page = await loadPhotos(offset);
      library.splice(offset, page.choices.length, ...page.choices);
    }
    showPhotos();
  });
  $('photoPanel').onkeydown = event => {
    if (event.key === 'Escape') closePhotos(true);
  };
  function field(id, label, value, max, onChange) {
    const group = element('div', 'line-field');
    const caption = element('label', '', label);
    caption.htmlFor = id;
    const input = element('textarea');
    Object.assign(input, {id, value, rows:2, maxLength:max, required:true});
    input.oninput = () => { input.setCustomValidity(''); onChange(input.value); };
    group.append(caption, input);
    return group;
  }
  function row(scene, index, count) {
    const item = element('li', 'scene-row');
    item.id = 'row-' + index;
    const name = '장면 ' + (index + 1);
    const toggle = element('button', 'plain scene-toggle', scene.excluded ? '다시 넣기' : '장면 빼기');
    Object.assign(toggle, {id:'toggle-' + index, type:'button', disabled:!scene.excluded && count === 1});
    toggle.setAttribute('aria-label', name + (scene.excluded ? ' 다시 넣기' : ' 빼기'));
    if (toggle.disabled) toggle.title = '영상에 사용할 장면이 하나 필요합니다.';
    toggle.onclick = () => {
      closePhotos();
      scene.excluded = !scene.excluded;
      renderRows();
      $('toggle-' + index).focus();
    };
    if (scene.excluded) {
      item.classList.add('excluded-scene');
      const summary = element('div', 'excluded-summary');
      summary.append(element('strong', '', name + ' 제외됨'), element('span', '', scene.text));
      item.append(summary, toggle);
      return item;
    }
    const media = element('div', 'scene-media');
    const frame = element('div', 'scene-photo');
    frame.id = 'photo-' + index;
    const number = element('small'); number.id = 'number-' + index;
    const change = element('button', 'plain', '사진 바꾸기');
    Object.assign(change, {id:'replace-' + index, type:'button'});
    change.setAttribute('aria-label', '장면 ' + (index + 1) + ' 사진 바꾸기');
    change.setAttribute('aria-expanded', 'false');
    change.setAttribute('aria-controls', 'photoPanel');
    change.onclick = () => openPhotos(index);
    media.append(frame, number, change);
    const lines = element('div', 'scene-lines');
    const dialogue = field('line-' + index, name + ' 대사', scene.text, 180, value => {scene.text = value;});
    dialogue.prepend(toggle);
    lines.append(dialogue);
    if (index === board.scenes.length - 1 && board.ending) {
      const ending = field('ending', '이어서 읽을 마지막 멘트', board.ending.text, 90, value => {board.ending.text = value;});
      const button = element('button', 'plain rewrite', 'AI로 다시 쓰기');
      Object.assign(button, {type:'button', title:'현재 대본으로 DeepSeek를 한 번 호출합니다.'});
      button.onclick = rewrite;
      ending.prepend(button);
      lines.append(ending);
    }
    const details = element('details', 'evidence');
    details.append(element('summary', '', '원문 확인'));
    if (scene.evidence) details.append(element('strong', '', '대본 작성에 인용한 원문 · 사진 ' + scene.evidencePhoto),
      element('blockquote', '', scene.evidence));
    const context = element('p'); context.id = 'context-' + index;
    details.append(element('strong', '', '선택한 사진 주변의 원문'), context);
    lines.querySelector('textarea').addEventListener('focus', () => {details.open = true;});
    lines.append(details);
    item.append(media, lines);
    return item;
  }
  function renderRows() {
    const count = board.scenes.filter(scene => !scene.excluded).length;
    const excluded = board.scenes.length - count;
    $('sceneCount').textContent = '영상에 ' + count + '개 장면' + (excluded ? ' · ' + excluded + '개 제외' : '');
    $('scenes').replaceChildren(...board.scenes.map((scene, index) => row(scene, index, count)));
    board.scenes.forEach((scene, index) => { if (!scene.excluded) displayPhoto(index); });
  }
  return {
    show(data, newArticle = false) {
      closePhotos();
      if (newArticle) { library = []; total = 0; }
      board = data;
      $('boardTitle').textContent = data.title.replaceAll('\n', ' ');
      renderRows();
    },
    edits(suggesting = false) {
      const fields = [...$('scenes').querySelectorAll('textarea')];
      for (const input of fields) {
        if (suggesting && input.id === 'ending') continue;
        const text = input.value.trim();
        input.setCustomValidity(!text ? '읽을 대사를 입력하세요.' :
          /[\x00-\x1f\x7f]/u.test(text) ? '대사는 줄바꿈 없이 한 줄로 입력하세요.' : '');
        if (!input.reportValidity()) return null;
      }
      const scenes = board.scenes.map(s => ({photo:s.photo, text:s.text.trim(), excluded:Boolean(s.excluded)}));
      return board.ending && !board.scenes.at(-1).excluded ? {scenes, ending:board.ending.text.trim()} : {scenes};
    },
    setEnding(text) {
      board.ending.text = text;
      $('ending').value = text;
      $('ending').setCustomValidity('');
    },
  };
}
