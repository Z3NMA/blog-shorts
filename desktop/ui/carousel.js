// Posters come from the same first-scene compositor as the exported video.
export function createCarousel(elements, remember) {
  const {deck, gallery, mode, modeName, arrows, prev, next, styleName, count, create, picker} = elements;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let styles = [], slides = [], tiles = [];
  let position = 0, target = 0, frame = 0, wheelTimer = 0, drag = null;

  function wrap(i) { return ((i % styles.length) + styles.length) % styles.length; }
  function index() { return wrap(Math.round(position)); }
  function pitch() { return (slides[0]?.offsetWidth || 160) * .94 + 14; }
  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(wheelTimer);
    frame = wheelTimer = 0;
  }
  function paint() {
    if (!styles.length) return;
    const step = pitch(), n = styles.length, selected = index();
    slides.forEach((card, i) => {
      const d = wrap(i - position + n / 2) - n / 2, distance = Math.abs(d);
      const scale = 1 - .16 * Math.min(1, distance) - .075 * Math.min(1, Math.max(0, distance - 1));
      card.style.transform = 'translate(-50%, -50%) translateX(' + d*step + 'px) scale(' + scale + ')';
      card.style.opacity = String(Math.max(0, 1 - .22*Math.min(distance,1) - .23*Math.max(0,distance-1)));
      card.style.visibility = distance > 2.7 ? 'hidden' : 'visible';
      card.style.zIndex = String(50 - Math.round(distance * 10));
    });
    if (styleName.textContent !== styles[selected].name) {
      styleName.textContent = styles[selected].name;
      count.textContent = (selected + 1) + ' / ' + n;
    }
    tiles.forEach((card, i) => card.setAttribute('aria-pressed', String(i === selected)));
  }
  function settle(value) {
    stop();
    target = value;
    const start = position, delta = target - start;
    function finish() {
      frame = 0;
      position = target = wrap(target);
      create.disabled = false;
      paint();
      remember(styles[index()].id);
    }
    if (reduceMotion.matches || Math.abs(delta) < .005) return finish();
    create.disabled = true;
    const begin = performance.now(), duration = Math.min(440, 200 + Math.abs(delta)*65);
    function step(now) {
      const t = Math.min(1, (now - begin)/duration);
      position = start + delta * (1 - Math.pow(1-t, 3));
      if (t === 1) return finish();
      paint();
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
  }
  function showGrid(open) {
    stop();
    position = target = Math.round(position);
    deck.hidden = arrows.hidden = open;
    gallery.hidden = !open;
    modeName.textContent = open ? '한 장씩 보기' : '모두 보기';
    mode.setAttribute('aria-expanded',String(open));
    create.disabled = false;
    paint();
  }
  function advance(amount) { settle(Math.round(frame ? target : position) + amount); }
  prev.onclick = () => advance(-1);
  next.onclick = () => advance(1);
  mode.onclick = () => showGrid(gallery.hidden);
  picker.addEventListener('keydown', e => {
    if (deck.hidden || e.target.closest('.scene-editor') || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    advance(e.key === 'ArrowLeft' ? -1 : 1);
  });
  deck.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    stop();
    const card = e.target.closest('.slide');
    drag = {id:e.pointerId, x:e.clientX, start:position, lastX:e.clientX, time:e.timeStamp,
      speed:0, moved:false, card:card ? Number(card.dataset.index) : null};
    deck.setPointerCapture(e.pointerId);
    deck.classList.add('dragging');
    create.disabled = true;
  });
  deck.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx)>4) drag.moved = true;
    if (!drag.moved) return;
    drag.speed = -(e.clientX - drag.lastX) / Math.max(1, e.timeStamp - drag.time) / pitch();
    drag.lastX = e.clientX;
    drag.time = e.timeStamp;
    position = drag.start - dx/pitch();
    paint();
  });
  function release(e, cancelled) {
    if (!drag || drag.id !== e.pointerId) return;
    const gesture = drag;
    drag = null;
    deck.classList.remove('dragging');
    if (deck.hasPointerCapture(e.pointerId)) deck.releasePointerCapture(e.pointerId);
    let end = position;
    if (!cancelled && !gesture.moved && gesture.card !== null) {
      end += wrap(gesture.card - position + styles.length/2) - styles.length/2;
    } else if (!cancelled && gesture.moved && e.timeStamp - gesture.time < 100) {
      end += Math.max(-1.75,Math.min(1.75,gesture.speed * 100));
    }
    settle(Math.round(end));
  }
  deck.onpointerup = e => release(e,false);
  deck.onpointercancel = e => release(e,true);
  deck.addEventListener('wheel', e => {
    let dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if (!dx || (!e.shiftKey && Math.abs(dx) < Math.abs(e.deltaY))) return;
    e.preventDefault();
    stop();
    if (e.deltaMode === 1) dx *= 16;
    if (e.deltaMode === 2) dx *= pitch();
    position += dx/pitch();
    create.disabled = true;
    paint();
    wheelTimer = setTimeout(() => settle(Math.round(position)),110);
  },{passive:false});
  new ResizeObserver(paint).observe(deck);

  return {
    get selected() { return styles[index()]; },
    reset(items, preferred) {
      stop();
      drag = null;
      styles = items;
      position = target = Math.max(0, styles.findIndex(s => s.id === preferred));
      slides = []; tiles = [];
      deck.replaceChildren(); gallery.replaceChildren();
      for (const [i, style] of styles.entries()) {
        const image = new Image();
        image.src = style.image;
        image.alt = '';
        image.draggable = false;
        const card = document.createElement('div');
        card.className = 'slide';
        card.dataset.index = i;
        card.setAttribute('aria-hidden','true');
        card.append(image);
        deck.append(card);
        slides.push(card);
        const tile = document.createElement('button');
        tile.type = 'button'; tile.className = 'tile';
        const label = document.createElement('span');
        label.textContent = style.name;
        tile.append(image.cloneNode(), label);
        tile.onclick = () => { position = target = i; showGrid(false); remember(style.id); mode.focus(); };
        gallery.append(tile);
        tiles.push(tile);
      }
      showGrid(false);
    },
    refresh() { showGrid(false); }
  };
}
