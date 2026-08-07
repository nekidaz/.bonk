<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { theme, setTheme, THEME_OPTIONS } from '../theme';
  import {
    historyLimit,
    historyPaused,
    clearHistory,
    openWorkspaceFolder,
    requestFollowRedirects,
    requestTimeoutMs,
    requestValidateTls,
    responseLineWrap,
    responseBodyLimitMb,
    workspacePath,
  } from '../stores';
  import { checkForUpdate, updateStatus } from '../updater';

  // Two-way bound from the parent (App.svelte holds the source of truth).
  let { open = $bindable() }: { open: boolean } = $props();

  // Resolved from the running Tauri app (single source of truth: tauri.conf.json,
  // which is generated from package.json). Falls back to an empty string in
  // non-Tauri browser smoke tests where the app API is unavailable.
  let appVersion = $state('');
  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      // getVersion is unavailable outside the Tauri runtime; leave it blank.
    }
  });

  const REPO_URL = 'https://github.com/nekidaz/.bonk';

  // History "keep last N" options. value 0 = keep everything ("All").
  const historyLimits: { label: string; value: number }[] = [
    { label: '50', value: 50 },
    { label: '100', value: 100 },
    { label: '200', value: 200 },
    { label: '500', value: 500 },
    { label: '1000', value: 1000 },
    { label: 'All', value: 0 },
  ];

  function close(): void {
    open = false;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function workspaceName(path: string): string {
    return path.split('/').filter(Boolean).at(-1) ?? 'Local Workspace';
  }

  function clampInt(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function setTimeoutMs(value: number): void {
    requestTimeoutMs.set(clampInt(value, 0, 600_000, 30_000));
  }

  function setBodyLimitMb(value: number): void {
    responseBodyLimitMb.set(clampInt(value, 1, 250, 25));
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true" aria-label="Settings">
    <div class="bs-modal bs-settings-modal">
      <div class="bs-modal-h">
        <div class="bs-settings-head">
          <div class="bs-settings-glyph" aria-hidden="true">
            <span class="material-symbols-outlined" style="font-size:20px">tune</span>
          </div>
          <div>
            <div class="t">Settings</div>
            <div class="bs-settings-subtitle">App behavior and workspace preferences</div>
          </div>
        </div>
        <button class="x" aria-label="Close" onclick={close}>
          <span class="material-symbols-outlined" style="font-size:18px">close</span>
        </button>
      </div>

      <div class="bs-modal-b">
        <div class="bs-settings-list">
          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">palette</span>
              </div>
              <div>
                <div class="bs-settings-kicker">Appearance</div>
                <div class="bs-settings-muted">Match the app chrome to your current workflow.</div>
              </div>
            </div>
            <div class="bs-settings-row bs-theme-row">
              <div>
                <span class="bs-settings-name">Theme</span>
                <span class="bs-settings-desc">Controls the full desktop shell and editor palette.</span>
              </div>
              <div class="bs-theme-grid" role="radiogroup" aria-label="Theme">
                {#each THEME_OPTIONS as t (t.value)}
                  <button
                    type="button"
                    class="bs-theme-option"
                    role="radio"
                    aria-checked={$theme === t.value}
                    class:on={$theme === t.value}
                    onclick={() => setTheme(t.value)}
                  >
                    <span
                      class="bs-theme-preview"
                      style:--theme-chrome={t.preview.chrome}
                      style:--theme-canvas={t.preview.canvas}
                      style:--theme-accent={t.preview.accent}
                      aria-hidden="true"
                    ></span>
                    <span class="bs-theme-label">{t.label}</span>
                    <span class="material-symbols-outlined bs-theme-check" style="font-size:13px" aria-hidden="true">check</span>
                  </button>
                {/each}
              </div>
            </div>
          </section>

          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">bolt</span>
              </div>
              <div>
                <div class="bs-settings-kicker">Request</div>
                <div class="bs-settings-muted">Network behavior for HTTP and gRPC calls.</div>
              </div>
            </div>
            <div class="bs-settings-row">
              <div>
                <span class="bs-settings-name">Request timeout</span>
                <span class="bs-settings-desc">Milliseconds before the request is stopped. Set 0 to disable.</span>
              </div>
              <label class="bs-settings-number">
                <input
                  type="number"
                  min="0"
                  max="600000"
                  step="1000"
                  value={$requestTimeoutMs}
                  oninput={(e) => setTimeoutMs(e.currentTarget.valueAsNumber)}
                />
                <span>ms</span>
              </label>
            </div>
            <label class="bs-settings-row bs-settings-toggle">
              <div>
                <span class="bs-settings-name">Follow redirects</span>
                <span class="bs-settings-desc">Allow 3xx redirects, including the final URL shown in the response.</span>
              </div>
              <input
                type="checkbox"
                checked={$requestFollowRedirects}
                onchange={(e) => requestFollowRedirects.set(e.currentTarget.checked)}
              />
            </label>
            <label class="bs-settings-row bs-settings-toggle">
              <div>
                <span class="bs-settings-name">Verify TLS certificates</span>
                <span class="bs-settings-desc">Keep enabled for real APIs; disable only for local or test certificates.</span>
              </div>
              <input
                type="checkbox"
                checked={$requestValidateTls}
                onchange={(e) => requestValidateTls.set(e.currentTarget.checked)}
              />
            </label>
          </section>

          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">data_object</span>
              </div>
              <div>
                <div class="bs-settings-kicker">Response</div>
                <div class="bs-settings-muted">Reading behavior for response bodies and errors.</div>
              </div>
            </div>
            <label class="bs-settings-row bs-settings-toggle">
              <div>
                <span class="bs-settings-name">Wrap long lines</span>
                <span class="bs-settings-desc">Useful for gRPC errors and compressed one-line payloads.</span>
              </div>
              <input
                type="checkbox"
                checked={$responseLineWrap}
                onchange={(e) => responseLineWrap.set(e.currentTarget.checked)}
              />
            </label>
            <div class="bs-settings-row">
              <div>
                <span class="bs-settings-name">Max response body</span>
                <span class="bs-settings-desc">Stops very large responses from freezing the editor.</span>
              </div>
              <label class="bs-settings-number">
                <input
                  type="number"
                  min="1"
                  max="250"
                  step="1"
                  value={$responseBodyLimitMb}
                  oninput={(e) => setBodyLimitMb(e.currentTarget.valueAsNumber)}
                />
                <span>MB</span>
              </label>
            </div>
          </section>

          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">history</span>
              </div>
              <div>
                <div class="bs-settings-kicker">History</div>
                <div class="bs-settings-muted">Control local request history retention.</div>
              </div>
            </div>
            <div class="bs-settings-row">
              <div>
                <span class="bs-settings-name">Keep last</span>
                <span class="bs-settings-desc">Older entries are trimmed automatically.</span>
              </div>
              <div class="bs-seg compact" role="radiogroup" aria-label="Keep last">
                {#each historyLimits as h (h.value)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={$historyLimit === h.value}
                    class:on={$historyLimit === h.value}
                    onclick={() => historyLimit.set(h.value)}
                  >{h.label}</button>
                {/each}
              </div>
            </div>
            <label class="bs-settings-row bs-settings-toggle">
              <div>
                <span class="bs-settings-name">Pause recording</span>
                <span class="bs-settings-desc">Requests still run, but no new history item is stored.</span>
              </div>
              <input
                type="checkbox"
                checked={$historyPaused}
                onchange={(e) => historyPaused.set(e.currentTarget.checked)}
              />
            </label>
            <div class="bs-settings-row">
              <div>
                <span class="bs-settings-name">Clear history</span>
                <span class="bs-settings-desc">Removes saved local history entries.</span>
              </div>
              <button type="button" class="bs-btn ghost danger" onclick={clearHistory}>Clear</button>
            </div>
          </section>

          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">folder</span>
              </div>
              <div>
                <div class="bs-settings-kicker">Workspace</div>
                <div class="bs-settings-muted">Requests are stored as files in the selected folder.</div>
              </div>
            </div>
            <div class="bs-settings-row">
              <div class="bs-settings-workspace">
                <span class="bs-settings-name">Current folder</span>
                {#if $workspacePath}
                  <span class="bs-settings-path" title={$workspacePath}>
                    <span class="material-symbols-outlined" style="font-size:15px">folder_open</span>
                    <span>{workspaceName($workspacePath)}</span>
                  </span>
                {:else}
                  <span class="bs-settings-desc">No workspace selected.</span>
                {/if}
              </div>
              <button type="button" class="bs-btn ghost" onclick={openWorkspaceFolder}>
                {$workspacePath ? 'Change' : 'Choose'}
              </button>
            </div>
          </section>

          <section class="bs-settings-section">
            <div class="bs-settings-section-head">
              <div class="bs-settings-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="font-size:18px">info</span>
              </div>
              <div>
                <div class="bs-settings-kicker">About</div>
                <div class="bs-settings-muted">bonk{appVersion ? ` ${appVersion}` : ''}</div>
              </div>
            </div>
            <div class="bs-settings-row">
              <div>
                <span class="bs-settings-name">Updates</span>
                <span class="bs-settings-desc">
                  {#if $updateStatus === 'checking'}Checking…
                  {:else if $updateStatus === 'available'}A new version is available — see the prompt.
                  {:else if $updateStatus === 'uptodate'}You're on the latest version.
                  {:else if $updateStatus === 'error'}Couldn't check — try again later.
                  {:else}Check for a newer signed release and install it in place.{/if}
                </span>
              </div>
              <button
                type="button"
                class="bs-btn ghost"
                disabled={$updateStatus === 'checking' || $updateStatus === 'downloading'}
                onclick={() => void checkForUpdate(true)}
              >Check for updates</button>
            </div>
            <div class="bs-settings-about">
              <div class="bs-settings-appname">bonk API Client</div>
              <div class="bs-settings-ver">HTTP and gRPC desktop client for local workspaces.</div>
              <a class="bs-link" href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL}</a>
            </div>
          </section>
        </div>
      </div>

      <div class="bs-modal-f">
        <div class="grow"></div>
        <button type="button" class="bs-btn ghost" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}
