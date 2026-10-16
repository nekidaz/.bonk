import { onDestroy, onMount, untrack } from 'svelte';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { watchCookieJar } from '$entities/cookies';
import { git, watchGitAutoFetch, watchGitWorkspace } from '$entities/git';
import { watchHistoryRetention } from '$entities/history';
import { t, watchDocumentLang } from '$shared/i18n';
import { flushPendingSaves, settingsFile } from '$shared/persist';
import {
  autoUpdateCheck,
  codeFont,
  codeFontSize,
  density,
  setTheme,
  loadCustomThemes,
  systemDarkTheme,
  systemLightTheme,
  themeFollowSystem,
  uiFontSize,
  uiZoom,
  watchAppearance,
} from '$shared/settings';
import { openSettingsFileTab } from '$features/settings';
import { checkForUpdate } from '$shared/updater';
import { inputs, watchInputs } from '$entities/input';
import { watchWorkspaceFiles, workspace } from '$entities/workspace';
import { runner, watchRunnerWorkspace } from '$features/runner';
import { layout } from './layout.svelte';
import { shell } from './shell.svelte';
import { hydrate } from './persistence.svelte';

/**
 * Everything the window does over its lifetime: restore state on start, keep appearance settings
 * applied, check for updates, flush saves on close. Call once from App's script: the effects and
 * listeners belong to App and stop when it unmounts (like `defer` in a Go main).
 */
export function startApp(): void {
  // ~/.bonk/settings.json: every setting module is loaded by now, so the first run can fill it from state.json.
  void settingsFile.load();

  // Watchers: each keeps something in sync with one slice's state for the whole session
  // (like goroutines started in main); onDestroy stops them.
  onDestroy(watchDocumentLang());
  onDestroy(watchAppearance());
  onDestroy(watchHistoryRetention());
  onDestroy(watchGitWorkspace());
  onDestroy(watchGitAutoFetch());
  onDestroy(watchCookieJar());
  onDestroy(watchRunnerWorkspace());
  onDestroy(watchWorkspaceFiles());
  onDestroy(
    watchInputs(
      () => workspace.path,
      () => workspace.metaRev,
    ),
  );

  layout.startEffects();

  // A failed git op (push rejected, checkout blocked…) says what git said.
  $effect(() => {
    const text = git.error;
    if (text) untrack(() => shell.showToast({ text, icon: 'error', iconColor: 'var(--color-danger)' }));
  });

  // A rebase finished (with «Отменить») or paused at an `edit`.
  $effect(() => {
    const n = git.notice;
    if (!n) return;
    untrack(() => {
      shell.showToast({ text: n.text, undo: n.undo, undoLabel: n.undo ? t('git.rb.undo') : undefined, icon: 'commit' });
      git.notice = null;
    });
  });

  $effect(() => {
    const text = inputs.error;
    if (text)
      untrack(() => {
        shell.showToast({ text, icon: 'error', iconColor: 'var(--color-danger)' });
        inputs.error = '';
      });
  });

  $effect(() => {
    const text = runner.error;
    if (text) untrack(() => shell.showToast({ text, icon: 'error', iconColor: 'var(--color-danger)' }));
  });

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

  // ⌘= / ⌘− / ⌘0 (app/hotkeys.ts): zoom the whole webview, like a browser.
  $effect(() => {
    const z = uiZoom.current;
    if (isTauri()) void getCurrentWebview().setZoom(z);
  });

  // «Как в системе»: track the OS appearance while the setting is on.
  $effect(() => {
    if (!themeFollowSystem.current) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(mq.matches ? systemDarkTheme.current : systemLightTheme.current);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  // User themes from ~/.bonk/themes; the localStorage copy already painted the saved one.
  onMount(() => {
    loadCustomThemes().catch(() => {});
  });

  // settings.json edited in another editor: picked up when the window comes back.
  onMount(() => {
    const reload = () => void settingsFile.reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  });

  // A settings.json that doesn't parse (at start, after an edit, or when a change can't be written).
  $effect(() => {
    const error = settingsFile.error;
    void settingsFile.unsaved;
    if (error)
      untrack(() =>
        shell.showToast({
          text: t('settingsFile.broken', { error }),
          icon: 'error',
          iconColor: 'var(--color-danger)',
          action: { label: t('settingsFile.open'), run: openSettingsFileTab },
        }),
      );
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
    const flush = () => void Promise.all([flushPendingSaves(), settingsFile.flush()]);
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
