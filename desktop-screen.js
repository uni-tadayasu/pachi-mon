/* Desktop viewport fit and an optional enlarged view. */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const root = document.documentElement;
  const screen = document.querySelector('.console-screen');
  const battleUI = document.getElementById('battle-ui');
  const battlePanel = document.getElementById('battle-panel');
  const expandButton = document.getElementById('fullscreen-btn');
  if (!screen || !battleUI || !battlePanel) return;

  // Move the existing controls, preserving their listeners and game state.
  // These anchors restore the exact mobile DOM order after a window resize.
  const uiHome = document.createComment('battle-ui mobile position');
  const panelHome = document.createComment('battle-panel mobile position');
  battleUI.before(uiHome);
  battlePanel.before(panelHome);
  const sidebar = document.createElement('div');
  sidebar.className = 'desktop-battle-sidebar';
  sidebar.setAttribute('role', 'group');
  sidebar.setAttribute('aria-label', '戦闘情報とコマンド');
  sidebar.hidden = true;
  screen.append(sidebar);

  let desktop = null;
  let wasPlaying = false;
  let frame = 0;
  let fallbackExpanded = false;
  let switchingFullscreen = false;
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isDesktop = () => !root.classList.contains('mobile-screen');
  const editable = target => {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    return !!(element?.isContentEditable || element?.closest?.('input,textarea,select'));
  };
  const dialogOpen = () => !!document.querySelector('dialog[open]');

  function moveBattleControls(nextDesktop, active) {
    const restoreFocus = active && (battleUI.contains(active) || battlePanel.contains(active));
    if (nextDesktop) {
      sidebar.append(battleUI, battlePanel);
    } else {
      uiHome.after(battleUI);
      panelHome.after(battlePanel);
    }
    if (restoreFocus && active.isConnected) active.focus({ preventScroll: true });
  }

  function fit() {
    frame = 0;
    const nextDesktop = isDesktop();
    const changedLayout = nextDesktop !== desktop;
    const playing = document.body.classList.contains('is-playing');
    const active = document.activeElement;
    root.classList.toggle('desktop-fit', nextDesktop);
    // A phone/tablet layout must never inherit an in-page desktop expansion.
    if (!nextDesktop) fallbackExpanded = false;
    // Reveal a desktop destination before restoring focus. Keep a desktop
    // source visible until its focused control has moved back to mobile.
    const hideSidebar = !nextDesktop || !document.body.classList.contains('in-battle');
    if (nextDesktop) sidebar.hidden = hideSidebar;
    if (changedLayout) moveBattleControls(nextDesktop, active);
    desktop = nextDesktop;
    sidebar.hidden = hideSidebar;

    const expanded = !!fullscreenElement() || fallbackExpanded;
    root.classList.toggle('desktop-expanded', desktop && expanded);
    if (expandButton) {
      const label = desktop ? (expanded ? '通常FITに戻す' : '拡大FIT') : (expanded ? '全画面表示を終了' : '全画面表示');
      expandButton.setAttribute('aria-pressed', String(expanded));
      expandButton.setAttribute('aria-label', label);
      expandButton.title = label;
    }
    // Starting a game or returning from a mobile window can retain an old page
    // offset. Keep dialogs, text editing and desktop browser zoom untouched.
    if (desktop && playing && (!wasPlaying || changedLayout) && !dialogOpen() && !editable(document.activeElement)) {
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    }
    wasPlaying = playing;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(fit);
  }

  async function toggle() {
    if (switchingFullscreen) return;
    switchingFullscreen = true;
    try {
      if (fullscreenElement()) {
        fallbackExpanded = false;
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (isDesktop() && fallbackExpanded) {
        fallbackExpanded = false;
      } else {
        // Show the enlarged fit immediately. If browser fullscreen is denied
        // (for example inside an embedded page), this remains a usable view.
        fallbackExpanded = isDesktop();
        fit();
        const enter = root.requestFullscreen || root.webkitRequestFullscreen;
        if (enter) await enter.call(root);
        if (fullscreenElement()) fallbackExpanded = false;
      }
    } catch (_) {
      // The in-page fit already works; a blocked native request needs no alert.
    } finally {
      switchingFullscreen = false;
      fit();
    }
  }

  function fullscreenChanged() {
    // Native Escape, browser UI and another fullscreen owner all determine the
    // actual state. Do not leave the enlarged CSS mode behind after an exit.
    fallbackExpanded = false;
    fit();
  }
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('webkitfullscreenchange', fullscreenChanged);
  document.addEventListener('pachi-viewport-change', schedule);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !isDesktop() || !fallbackExpanded || fullscreenElement() || dialogOpen() || editable(event.target)) return;
    fallbackExpanded = false;
    event.preventDefault();
    // The game also uses Escape for its menu. Consume only the fallback exit;
    // an open dialog or editor keeps its normal Escape behavior above.
    event.stopImmediatePropagation();
    fit();
  }, true);

  LT.DesktopScreen = Object.freeze({ toggle, fit: schedule });
  fit();
})();
