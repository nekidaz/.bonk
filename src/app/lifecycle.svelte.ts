import { onDestroy, onMount } from 'svelte';
import { watchCookieJar } from '$entities/cookies';
import { watchGitWorkspace } from '$entities/git';
import { watchHistoryRetention } from '$entities/history';
import { watchDocumentLang } from '$shared/i18n';
import { flushPendingSaves } from '$shared/persist';
import {
  autoUpdateCheck,
  codeFont,
  codeFontSize,
  density,
  setTheme,
  themeFollowSystem,
  uiFontSize,
} from '$shared/settings';
import { checkForUpdate } from '$shared/updater';
import { layout } from './layout.svelte';
import { hydrate } from './persistence.svelte';

/**
 * Everything the window does over its lifetime: restore state on start, keep appearance settings
 * applied, check for updates, flush saves on close. Call once from App's script: the effects and
 * listeners belong to App and stop when it unmounts (like `defer` in a Go main).
 */
export function startApp(): void {
  // Watchers: each keeps something in sync with one slice's state for the whole session
  // (like goroutines started in main); onDestroy stops them.
  onDestroy(watchDocumentLang());
  onDestroy(watchHistoryRetention());
  onDestroy(watchGitWorkspace());
  onDestroy(watchCookieJar());

  layout.startEffects();

  // Settings → Внешний вид: text size shifts the whole type scale (13 = design default),
  // the code font/size feed --font-code and the editors, density sets row heights.
  $effect(() => {
    const root = document.documentElement;
    const d = uiFontSize.current - 13;
    for (const [token, base] of [
      ['micro', 10],
      ['caption', 11],
      ['body', 12],
      ['ui', 13],
      ['label', 14],
      ['title', 15],
    ] as const) {
      root.style.setProperty(`--font-size-${token}`, `${base + d}px`);
    }
    root.style.setProperty(
      '--font-code',
      `'${codeFont.current}', 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace`,
    );
    root.style.setProperty('--code-font-size', `${codeFontSize.current}px`);
    root.dataset.density = density.current;
  });

  // «Как в системе»: track the OS appearance while the setting is on.
  $effect(() => {
    if (!themeFollowSystem.current) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(mq.matches ? 'smooth-dark' : 'smooth-light');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  onMount(async () => {
    await hydrate();
    await layout.load();
  });

  onMount(() => {
    const onResize = () => layout.clampResponseToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Silently check for an update shortly after launch (Settings → Общие can turn
  // it off); the banner only appears if one is available (failures stay quiet).
  onMount(() => {
    const t = setTimeout(
      () =>
        void autoUpdateCheck.ready.then(() => {
          if (autoUpdateCheck.current) void checkForUpdate();
        }),
      2500,
    );
    return () => clearTimeout(t);
  });

  onMount(() => {
    const flush = () => void flushPendingSaves();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    // pagehide also fires on macOS Tauri window close, where beforeunload can be
    // skipped; without it the last debounced save can be lost.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });
}
