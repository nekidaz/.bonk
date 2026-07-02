<script lang="ts">
  import {
    activeTabId,
    closeTab,
    newTab,
    duplicateTab,
    closeOtherTabs,
    closeAllTabs,
    tabs,
    environments,
    activeEnvironmentId,
    setActiveEnvironment,
    openEnvironmentsTab,
    openRunnerTab,
  } from '../stores';
  import { methodColor } from '../domain/method';
  import type { Tab } from '../domain/types';

  let {
    sidebarHidden = $bindable(),
    onNew,
  }: {
    sidebarHidden: boolean;
    onNew: (e: MouseEvent) => void;
  } = $props();

  // Environment picker open state; App's window pointerdown listener closes it
  // on outside-click (the picker stops pointer-down propagation).
  let envMenuOpen = $state(false);

  // The tab strip scrolls horizontally so many open tabs can never push the
  // Runner / environment / sidebar controls out of the window. Keep the active
  // tab visible when it changes (new tab, tab switch).
  let tabsScrollEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const id = $activeTabId;
    tabsScrollEl
      ?.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });

  // Vertical mouse-wheel over the strip scrolls it horizontally (trackpads
  // already produce deltaX natively). Attached manually because Svelte wheel
  // attributes are passive — preventDefault would be ignored, and without it
  // the page behind would rubber-band.
  $effect(() => {
    const el = tabsScrollEl;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Right-click context menu on a tab (Postman-style). Position is clamped to
  // the viewport; App's window pointerdown closes it (the menu itself stops
  // pointer-down propagation), Escape closes it too.
  const CTX_MENU_WIDTH = 240;
  let ctxMenu = $state<{ x: number; y: number; tabId: string } | null>(null);
  function openTabContext(e: MouseEvent, tabId: string): void {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = {
      x: Math.min(e.clientX, window.innerWidth - CTX_MENU_WIDTH - 8),
      y: e.clientY,
      tabId,
    };
  }
  // Snapshot the target tab id BEFORE nulling ctxMenu: the menu template must
  // never read ctxMenu after it's cleared (a {@const ctxMenu.tabId} would be
  // re-evaluated against null during the teardown flush and throw).
  function ctxAction(fn: (tabId: string) => void): void {
    if (!ctxMenu) return;
    const id = ctxMenu.tabId;
    ctxMenu = null;
    fn(id);
  }

  const activeEnvName = $derived(
    $environments.find((e) => e.id === $activeEnvironmentId)?.name ?? 'No environment',
  );

  function chooseEnv(id: string | null): void {
    envMenuOpen = false;
    setActiveEnvironment(id);
  }
  function manage(): void {
    envMenuOpen = false;
    openEnvironmentsTab();
  }

  function tabMethodLabel(t: Tab): string {
    if (t.protocol === 'grpc') return 'gRPC';
    if (t.protocol === 'git') return 'DIFF';
    if (t.protocol === 'env') return 'ENV';
    if (t.protocol === 'runner') return 'RUN';
    return t.request.method;
  }

  function tabMethodColor(t: Tab): string {
    if (t.protocol === 'git' || t.protocol === 'env' || t.protocol === 'runner') return 'var(--accent)';
    return methodColor(t.protocol === 'grpc' ? 'GRPC' : t.request.method);
  }
</script>

<svelte:window
  onpointerdown={() => { envMenuOpen = false; ctxMenu = null; }}
  onkeydown={(e) => { if (e.key === 'Escape' && ctxMenu) { e.preventDefault(); ctxMenu = null; } }}
/>

<div class="bs-tabbar">
  <div class="bs-tabs-scroll" bind:this={tabsScrollEl} role="presentation" oncontextmenu={(e) => openTabContext(e, $activeTabId)}>
    {#each $tabs as t (t.id)}
      <div class="bs-tab" class:on={t.id === $activeTabId} role="presentation" data-tab-id={t.id} oncontextmenu={(e) => openTabContext(e, t.id)}>
        <button class="bs-tab-hit" role="tab" aria-selected={t.id === $activeTabId} type="button" onclick={() => activeTabId.set(t.id)}>
          <span class="m" style="color:{tabMethodColor(t)}">{tabMethodLabel(t)}</span>
          <span class="bs-nm">{t.title}</span>
        </button>
        <button class="x" aria-label="Close" onclick={(e) => { e.stopPropagation(); closeTab(t.id); }}><span class="material-symbols-outlined" style="font-size:13px">close</span></button>
      </div>
    {/each}
    <button class="bs-addt" title="New" onclick={onNew}><span class="material-symbols-outlined" style="font-size:18px">add</span></button>
  </div>
  <button class="bs-runbtn" title="Collection Runner" onclick={openRunnerTab}>
    <span class="material-symbols-outlined" style="font-size:14px">play_circle</span>
    <span class="bs-runbtn-name">Runner</span>
  </button>
  <div class="bs-env-pick" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-env-btn" class:open={envMenuOpen} title="Environment" onclick={() => (envMenuOpen = !envMenuOpen)}>
      <span class="material-symbols-outlined" style="font-size:14px">layers</span>
      <span class="bs-env-btn-name">{activeEnvName}</span>
      <span class="material-symbols-outlined" style="font-size:14px">expand_more</span>
    </button>
    {#if envMenuOpen}
      <div class="bs-env-menu">
        <button class="bs-env-mitem" type="button" class:on={$activeEnvironmentId === null} onclick={() => chooseEnv(null)}>
          <span class="material-symbols-outlined" style="font-size:16px">{$activeEnvironmentId === null ? 'check' : 'block'}</span>
          <span class="text">No environment</span>
        </button>
        {#if $environments.length > 0}<div class="bs-env-msep"></div>{/if}
        {#each $environments as e (e.id)}
          <button class="bs-env-mitem" type="button" class:on={$activeEnvironmentId === e.id} onclick={() => chooseEnv(e.id)}>
            <span class="material-symbols-outlined" style="font-size:16px">{$activeEnvironmentId === e.id ? 'check' : 'layers'}</span>
            <span class="text">{e.name}</span>
          </button>
        {/each}
        <div class="bs-env-msep"></div>
        <button class="bs-env-mitem action" type="button" onclick={manage}>
          <span class="material-symbols-outlined" style="font-size:16px">tune</span>
          <span class="text">Manage environments…</span>
        </button>
      </div>
    {/if}
  </div>
  <button class="bs-tbi" title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} onclick={() => (sidebarHidden = !sidebarHidden)}><span class="material-symbols-outlined" style="font-size:15px">view_sidebar</span></button>
</div>

{#if ctxMenu}
  <div class="bs-tab-ctx" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => newTab())}>
      <span class="text">New Request</span><span class="sc">⌘T</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => duplicateTab(id))}>
      <span class="text">Duplicate Tab</span>
    </button>
    <div class="bs-tab-ctx-sep"></div>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => closeTab(id))}>
      <span class="text">Close Tab</span><span class="sc">⌘W</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction((id) => closeOtherTabs(id))}>
      <span class="text">Close Other Tabs</span>
    </button>
    <button class="bs-tab-ctx-item" type="button" onclick={() => ctxAction(() => closeAllTabs())}>
      <span class="text">Close All Tabs</span>
    </button>
  </div>
{/if}

<style>
  .bs-runbtn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    margin-right: 6px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--t2);
  }
  .bs-runbtn:hover { background: var(--hover); color: var(--text); }
  .bs-runbtn .material-symbols-outlined { color: var(--accent); flex: none; }
  .bs-env-pick { position: relative; margin-right: 6px; }
  .bs-env-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--t2);
    max-width: 220px;
  }
  .bs-env-btn:hover, .bs-env-btn.open { background: var(--hover); color: var(--text); }
  .bs-env-btn .material-symbols-outlined { color: var(--t3); flex: none; }
  .bs-env-btn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-env-menu {
    position: absolute;
    top: 30px;
    right: 0;
    min-width: 220px;
    max-width: 300px;
    background: var(--surface);
    border: 0.5px solid var(--sep);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 5px;
    z-index: 40;
  }
  .bs-env-msep { height: 0.5px; background: var(--sepsoft); margin: 5px 4px; }
  .bs-env-mitem {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--text);
    text-align: left;
  }
  .bs-env-mitem:hover { background: var(--hover); }
  .bs-env-mitem.on { background: var(--hover2); }
  .bs-env-mitem .material-symbols-outlined { color: var(--t2); flex: none; }
  .bs-env-mitem.action { color: var(--accent); }
  .bs-env-mitem.action .material-symbols-outlined { color: var(--accent); }
  .bs-env-mitem .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-tab-ctx {
    position: fixed;
    min-width: 240px;
    background: var(--surface);
    border: 0.5px solid var(--sep);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 5px;
    z-index: 60;
  }
  .bs-tab-ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--text);
    text-align: left;
  }
  .bs-tab-ctx-item:hover { background: var(--hover); }
  .bs-tab-ctx-item .text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-tab-ctx-item .sc { color: var(--t3); font-size: 12px; letter-spacing: 0.08em; }
  .bs-tab-ctx-sep { height: 0.5px; background: var(--sepsoft); margin: 5px 4px; }
</style>
