export function initWindowControls(onError) {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow();
  if (!appWindow) return;
  const minimize = document.getElementById('windowMinimize');
  const maximize = document.getElementById('windowMaximize');
  const close = document.getElementById('windowClose');
  async function syncMaximized() {
    const maximized = await appWindow.isMaximized();
    const label = maximized ? '이전 크기로 복원' : '최대화';
    maximize.title = label;
    maximize.setAttribute('aria-label', label);
    maximize.classList.toggle('is-maximized', maximized);
  }
  minimize.onclick = () => appWindow.minimize().catch(onError);
  maximize.onclick = () => appWindow.toggleMaximize().then(syncMaximized).catch(onError);
  close.onclick = () => appWindow.close().catch(onError);
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => syncMaximized().catch(onError), 80);
  });
  document.querySelector('.window-actions').hidden = false;
  syncMaximized().catch(onError);
}
