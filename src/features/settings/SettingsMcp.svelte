<script lang="ts">
  import { onMount } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import {
    installMcpIntegration,
    mcpClientConfig,
    mcpIntegrationStatus,
    mcpJournal,
    revealPath,
    uninstallMcpIntegration,
    type McpClientStatus,
    type McpInstallOptions,
    type McpIntegrationStatus,
    type McpJournalEntry,
    type McpMethodPolicy,
  } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import { workspace } from '$entities/workspace';
  import { environments, mcpPrefs, allowedEnvNames, timeAgo } from '$entities/environment';
  import McpEnvPicker from './McpEnvPicker.svelte';
  import { methodColor } from '$shared/model';
  import { row, sw, select, chips } from './ui.svelte';
  import Row from './Row.svelte';

  let status = $state<McpIntegrationStatus | null>(null);
  let journal = $state<McpJournalEntry[]>([]);
  let busy = $state<string | null>(null); // client id, 'all' or 'off'
  let error = $state('');
  let copied = $state(false);
  let fullLog = $state(false);

  // Unique: the allow-list is by name, and two environments may share one (a duplicate key would crash the {#each}).
  const envNames = $derived([...new Set(environments.list.map((e) => e.name))]);
  const allowedEnvs = $derived(allowedEnvNames(mcpPrefs.current, environments.list));
  const opts = $derived<McpInstallOptions>({
    workspace: workspace.path,
    readOnly: !mcpPrefs.current.allowWrites,
    noNetwork: !mcpPrefs.current.allowNetwork,
    targetHosts: mcpPrefs.current.targetHosts,
    exposeSecrets: mcpPrefs.current.exposeSecrets,
    environments: envNames.filter((n) => allowedEnvs.has(n)),
    mutatingMethods: mcpPrefs.current.mutatingMethods,
  });
  const noWs = $derived(!workspace.path);
  const off = $derived(noWs || status?.binaryAvailable === false);
  const stale = $derived(status?.clients.filter((c) => c.installed) ?? []);

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const tilde = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+/, '~');
  function shortPath(p: string): string {
    const parts = tilde(p).split('/');
    return parts.length > 4 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : parts.join('/');
  }
  const initials = (c: string) =>
    /codex/i.test(c)
      ? 'CX'
      : (c.match(/\b\p{L}/gu)?.length ?? 0) > 1
        ? c
            .match(/\b\p{L}/gu)!
            .slice(0, 2)
            .join('')
            .toUpperCase()
        : c.slice(0, 2).toUpperCase();
  const clientName = (id: string) => status?.clients.find((c) => c.id === id)?.name ?? id;

  async function refresh(): Promise<void> {
    try {
      status = await mcpIntegrationStatus();
    } catch {
      /* unavailable in browser previews */
    }
    try {
      journal = await mcpJournal(50);
    } catch {
      /* same */
    }
  }

  async function run(key: string, job: () => Promise<{ status: McpIntegrationStatus }>): Promise<void> {
    busy = key;
    error = '';
    try {
      status = (await job()).status;
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
    void refresh();
  }
  const install = (ids: string[]) =>
    run(ids.length === 1 ? ids[0] : 'all', () => installMcpIntegration({ ...opts, clients: ids }));
  const refreshAll = () => install(stale.map((c) => c.id));
  const disconnect = (id: string) => run(id, () => uninstallMcpIntegration([id]));
  async function disconnectAll(): Promise<void> {
    if (!(await requestConfirm(t('settings.mcp.off.confirm'), t('settings.mcp.off.ok')))) return;
    await run('off', () => uninstallMcpIntegration());
  }
  async function copyConfig(): Promise<void> {
    error = '';
    try {
      await navigator.clipboard.writeText(await mcpClientConfig(opts));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (e) {
      error = errText(e);
    }
  }

  // Keep installed clients' configs in sync with the permissions (debounced).
  let armed = $state(false);
  let lastKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const key = JSON.stringify(opts);
    if (!armed) return;
    if (lastKey === null || key === lastKey) {
      lastKey = key;
      return;
    }
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ids = stale.map((c) => c.id);
      if (ids.length && !off) void install(ids);
    }, 600);
  });

  onMount(() => {
    void refresh();
    void mcpPrefs.ready.then(() => (armed = true));
    const poll = setInterval(() => void refresh(), 10_000);
    return () => {
      clearInterval(poll);
      clearTimeout(timer);
    };
  });

  const patch = (p: Partial<typeof mcpPrefs.current>) => (mcpPrefs.current = { ...mcpPrefs.current, ...p });
  const METHODS = $derived<{ label: string; value: McpMethodPolicy }[]>([
    { label: t('settings.mcp.m.allow'), value: 'allow' },
    { label: t('settings.mcp.m.ask'), value: 'ask' },
    { label: t('settings.mcp.m.deny'), value: 'deny' },
  ]);

  function pill(c: McpClientStatus): 'on' | 'update' | 'off' {
    return c.installed ? (c.needsUpdate ? 'update' : 'on') : 'off';
  }
  function sub(c: McpClientStatus): string {
    if (c.error) return c.error;
    if (c.installed && c.needsUpdate) return t('settings.mcp.stale', { path: c.configPath ? tilde(c.configPath) : '' });
    if (c.installed)
      return c.lastCallAt
        ? t('settings.mcp.last', { ago: timeAgo(c.lastCallAt, Date.now(), t) })
        : t('settings.mcp.never');
    return c.available ? t('settings.mcp.found') : t('settings.mcp.missing');
  }
  const VERBS: Record<string, string> = {
    create_folder: 'create',
    duplicate_node: 'create',
    save_request: 'change',
    rename_node: 'change',
    delete_node: 'delete',
    move_node: 'move',
  };
  const shown = $derived(fullLog ? journal : journal.slice(0, 3));
</script>

{#if noWs}<p class="st-err st-mcp-hint">{t('settings.mcp.pick')}</p>{/if}

<div class="st-mcp-cols">
  <div class="st-mcp-col st-mcp-left">
    <div class="st-mcp-cap">
      <span class="st-group">{t('settings.mcp.clients')}</span>
      <button
        type="button"
        class="st-mcp-link"
        disabled={off || !stale.length || busy !== null}
        onclick={() => void refreshAll()}
      >
        <span class="material-symbols-outlined" aria-hidden="true">sync</span>{t('settings.mcp.refreshAll')}
      </button>
    </div>
    <div class="st-card st-mcp-card">
      {#each status?.clients ?? [] as c (c.id)}
        {@const p = pill(c)}
        <div class="st-mcp-client">
          <span class="st-mcp-av">{initials(c.name)}</span>
          <div class="st-copy">
            <span class="st-name"
              >{c.name}
              <span class="st-mcp-pill {p}"
                ><i></i>{t(
                  p === 'on' ? 'settings.mcp.st.on' : p === 'update' ? 'settings.mcp.st.update' : 'settings.mcp.st.off',
                )}</span
              >
            </span>
            <span class="st-desc st-mcp-ellip" title={sub(c)}>{sub(c)}</span>
          </div>
          {#if p === 'on'}
            <button
              type="button"
              class="st-mcp-btn ghost"
              disabled={busy !== null}
              onclick={() => void disconnect(c.id)}>{t('settings.mcp.act.disconnect')}</button
            >
          {:else}
            <button
              type="button"
              class="st-mcp-btn"
              disabled={off || !c.available || busy !== null}
              onclick={() => void install([c.id])}
              >{t(p === 'update' ? 'settings.mcp.act.update' : 'settings.mcp.act.connect')}</button
            >
          {/if}
        </div>
      {/each}
    </div>
    {#if error}<div class="st-err" role="alert">{error}</div>{/if}

    <div class="st-group">{t('settings.mcp.ai')}</div>
    <div class="st-card st-mcp-card">
      {#snippet always()}<span class="st-mcp-always"
          ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{t('settings.mcp.always')}</span
        >{/snippet}
      {@render row(t('settings.mcp.read'), t('settings.mcp.read.desc'), always)}
      {#snippet s1()}{@render sw(t('settings.mcp.write'), mcpPrefs.current.allowWrites, (v) =>
          patch({ allowWrites: v }),
        )}{/snippet}
      {@render row(t('settings.mcp.write'), t('settings.mcp.write.desc'), s1)}
      {#snippet s2()}{@render sw(t('settings.mcp.net'), mcpPrefs.current.allowNetwork, (v) =>
          patch({ allowNetwork: v }),
        )}{/snippet}
      {@render row(t('settings.mcp.net'), t('settings.mcp.net.desc'), s2)}
      <Row class={['st-mcp-envs', { 'st-mcp-dim': !mcpPrefs.current.allowNetwork }]}>
        <div class="st-copy">
          <span class="st-name">{t('settings.mcp.envs')}</span><span class="st-desc">{t('settings.mcp.envs.sub')}</span>
        </div>
        <McpEnvPicker disabled={!mcpPrefs.current.allowNetwork} />
      </Row>
      <div class:st-mcp-dim={!mcpPrefs.current.allowNetwork}>
        {#snippet s3()}<div class:st-mcp-off={!mcpPrefs.current.allowNetwork}>
            {@render select(t('settings.mcp.methods.desc'), mcpPrefs.current.mutatingMethods, METHODS, (v) =>
              patch({ mutatingMethods: v as McpMethodPolicy }),
            )}
          </div>{/snippet}
        {@render row(t('settings.mcp.methods'), t('settings.mcp.methods.desc'), s3)}
      </div>
      {#snippet s4()}{@render sw(t('settings.mcp.secrets'), mcpPrefs.current.exposeSecrets, (v) =>
          patch({ exposeSecrets: v }),
        )}{/snippet}
      {@render row(t('settings.mcp.secrets'), t('settings.mcp.secrets.desc'), s4)}
    </div>
  </div>

  <div class="st-mcp-col st-mcp-right">
    <div class="st-group">{t('settings.mcp.server')}</div>
    <div class="st-card st-pad st-mcp-srv">
      {#if status?.binaryAvailable === false}
        <div class="st-mcp-run"><i class="bad"></i><b>{t('settings.mcp.notfound')}</b></div>
        <span class="st-desc">{t('settings.mcp.notfound.hint')}</span>
      {:else}
        <div class="st-mcp-run">
          <i></i><b>{t('settings.mcp.running')}</b><span class="st-desc">stdio · bonk-mcp {status?.version ?? ''}</span>
        </div>
      {/if}
      <span class="st-mcp-capt">{t('settings.mcp.ws')}</span>
      <div class="st-mcp-wsrow">
        <span class="st-mcp-ws" title={workspace.path}>{workspace.path ? shortPath(workspace.path) : '—'}</span>
        <button
          type="button"
          class="st-mcp-ic"
          aria-label={t('settings.mcp.reveal')}
          title={t('settings.mcp.reveal')}
          disabled={noWs}
          onclick={() => void revealPath(workspace.path).catch((e) => (error = errText(e)))}
        >
          <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        </button>
      </div>
      <button type="button" class="st-mcp-btn ghost wide" disabled={off} onclick={() => void copyConfig()}>
        <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{copied
          ? t('settings.mcp.copied')
          : t('settings.mcp.copyCfg')}
      </button>
    </div>

    <div class="st-group">{t('settings.mcp.hosts')}</div>
    <div class="st-card st-pad st-mcp-srv">
      {@render chips(t('settings.mcp.hosts'), mcpPrefs.current.targetHosts, t('settings.mcp.hosts.add'), (h) =>
        patch({ targetHosts: h }),
      )}
      <p class="st-note">{t('settings.mcp.hosts.note')}</p>
    </div>

    <div class="st-mcp-cap">
      <span class="st-group">{t('settings.mcp.journal')}</span>
      {#if journal.length > 3}
        <button type="button" class="st-mcp-link" onclick={() => (fullLog = !fullLog)}
          >{fullLog ? t('settings.mcp.less') : t('settings.mcp.all')}</button
        >
      {/if}
    </div>
    <div class="st-card st-mcp-card st-mcp-log" class:full={fullLog}>
      {#each shown as e, i (e.at + ':' + i)}
        {@const verb = VERBS[e.tool]}
        <div class="st-mcp-ev">
          <span class="st-mcp-av sm">{initials(e.client ? clientName(e.client) : 'AI')}</span>
          <div class="st-copy">
            <span class="st-name st-mcp-ellip">
              {#if e.method}<b style="color:{methodColor(e.method)}">{e.method}</b>{:else if verb}<span class="st-desc"
                  >{t(`settings.mcp.v.${verb}`)}</span
                >{:else}<span class="st-desc">{e.tool}</span>{/if}
              {e.target ?? ''}
            </span>
            <span
              class="st-desc st-mcp-ellip"
              class:ok={e.outcome === 'ok'}
              class:bad={e.outcome !== 'ok' && e.outcome === 'denied'}
            >
              {#if e.outcome === 'denied'}{[e.env, t('settings.mcp.denied')].filter(Boolean).join(' · ')}
              {:else}{[e.env, e.status ?? e.summary]
                  .filter((x) => x !== null && x !== undefined && x !== '')
                  .join(' · ')}{/if}
            </span>
          </div>
          <span class="st-desc">{timeAgo(e.at, Date.now(), t)}</span>
        </div>
      {:else}
        <p class="st-note st-pad">{t('settings.mcp.empty')}</p>
      {/each}
    </div>

    <button
      type="button"
      class="st-mcp-btn ghost danger wide"
      disabled={busy !== null || !stale.length}
      onclick={() => void disconnectAll()}
    >
      <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>{t('settings.mcp.off')}
    </button>
  </div>
</div>

<style>
  .st-mcp-link:hover:not(:disabled) {
    color: var(--color-text);
  }

  .st-mcp-btn.ghost:hover:not(:disabled) {
    background: var(--color-hover);
  }

  .st-mcp-ic:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  /* Settings → AI / MCP (S32.8): 462 + 270 columns. */
  .st-mcp-hint {
    padding: 0;
    margin: -8px 0 0;
  }

  .st-mcp-cols {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .st-mcp-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .st-mcp-left {
    flex: 1 1 462px;
  }

  /* flexible so the scrollbar gutter can't push the right column out */
  .st-mcp-right {
    flex: 0 0 270px;
  }

  .st-mcp-cap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: -4px;
  }

  .st-mcp-cap :global(.st-group) {
    margin: 0;
  }

  .st-mcp-col > :global(.st-group) {
    margin-bottom: -4px;
  }

  .st-mcp-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
    cursor: pointer;
  }

  .st-mcp-link:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .st-mcp-link :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  .st-mcp-card :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  .st-mcp-btn :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  .st-mcp-ic :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  .st-mcp-client {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
  }

  .st-mcp-client + .st-mcp-client {
    border-top: 1px solid var(--color-border-subtle);
  }

  .st-mcp-client :global(.st-copy) {
    flex: 1;
  }

  .st-mcp-av {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--color-hover);
    font: 600 11px var(--font-code);
    color: var(--color-text-secondary);
  }

  .st-mcp-av.sm {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    font-size: 9px;
  }

  .st-mcp-ellip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .st-mcp-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    margin-left: 6px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--color-hover);
    color: var(--color-text-muted);
    font: 500 11px var(--font-ui);
    vertical-align: 1px;
  }

  .st-mcp-pill :global(i) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .st-mcp-run :global(i) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .st-mcp-pill.on {
    color: var(--green);
    background: color-mix(in srgb, var(--green) 14%, transparent);
  }

  .st-mcp-pill.update {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
  }

  .st-mcp-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--color-text);
    color: var(--color-raised);
    font: 600 var(--font-size-body) var(--font-ui);
    cursor: pointer;
  }

  .st-mcp-btn.ghost {
    background: transparent;
    border-color: var(--color-border-subtle);
    color: var(--color-text);
  }

  .st-mcp-btn.danger {
    color: var(--red);
  }

  .st-mcp-btn.wide {
    width: 100%;
  }

  .st-mcp-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .st-mcp-always {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .st-mcp-envs {
    gap: 12px;
  }

  .st-mcp-envs > :global(.st-name) {
    flex: none;
    white-space: nowrap;
  }

  /* S32.8 rows are 46–51 px, a bit denser than the other settings pages. */
  .st-mcp-card :global(.st-row) {
    min-height: 48px;
    padding: 8px 0;
  }

  .st-mcp-dim {
    opacity: 0.45;
  }

  .st-mcp-off {
    pointer-events: none;
  }

  .st-mcp-srv {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .st-mcp-run {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .st-mcp-run :global(i) {
    width: 8px;
    height: 8px;
    color: var(--green);
  }

  .st-mcp-run :global(i.bad) {
    color: var(--red);
  }

  .st-mcp-capt {
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--color-text-muted);
  }

  .st-mcp-wsrow {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .st-mcp-ws {
    flex: 1;
    min-width: 0;
    height: 30px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    background: var(--color-panel);
    font: var(--font-size-caption) var(--font-code);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .st-mcp-ic {
    flex: none;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .st-mcp-ic:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .st-mcp-log.full {
    max-height: 260px;
    overflow-y: auto;
  }

  .st-mcp-ev {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 0;
  }

  .st-mcp-ev + .st-mcp-ev {
    border-top: 1px solid var(--color-border-subtle);
  }

  .st-mcp-ev :global(.st-copy) {
    flex: 1;
  }

  .st-mcp-ev :global(.st-name) {
    font-size: var(--font-size-caption);
    font-family: var(--font-code);
  }

  .st-mcp-ev :global(.ok) {
    color: var(--green);
  }

  .st-mcp-ev :global(.bad) {
    color: var(--red);
  }
</style>
