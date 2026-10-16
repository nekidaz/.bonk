<script lang="ts">
  // The main column: tab bar, the active tab's view (request editor + response, or a special tab),
  // the welcome screen when nothing is open, and the utility panel (console / terminal) below.
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { tabs } from '$entities/tab';
  import { workspace } from '$entities/workspace';
  import { applyCurlToActiveTab, openSavedRequest, requestGrpcEditorAction, scriptUi } from '$entities/request';
  import { clock, historyDay, matchSaved, searchRequests } from '$entities/environment';
  import { history } from '$entities/history';
  import { newTab, requestCloseTab } from '$features/tabs';
  import { t } from '$shared/i18n';
  import { saveState } from '$shared/persist';
  import { focusMode } from '$shared/ui';
  import { ResponseStrip, ResponsePane } from '$features/response/components';
  import { GrpcEditor } from '$features/grpc/components';
  import { HttpRequestEditor } from '$features/http/components';
  import {
    CommitEditor,
    CompareView,
    ConflictsView,
    FileHistoryView,
    GitDiffView,
    GraphView,
    MergeEditor,
    ProjectDiffView,
    ReflogView,
    StashView,
  } from '$features/git/components';
  import { EnvironmentsSheet } from '$features/environments/components';
  import { RunnerView } from '$features/runner/components';
  import { SettingsFileView } from '$features/settings/components';
  import { UtilityPanel } from '$features/utility-panel/components';
  import { utilityUi } from '$features/utility-panel';
  import AppTabBar from './AppTabBar.svelte';
  import FocusBar from './FocusBar.svelte';
  import RequestHeader from './RequestHeader.svelte';
  import RequestStrip from './RequestStrip.svelte';
  import WelcomeView from './WelcomeView.svelte';
  import {
    importFrom,
    newRequestHere,
    openSaveDialog,
    smartSave,
    tabContext,
    tabKeydown,
    toggleCodePanel,
  } from './actions';
  import { layout } from './layout.svelte';
  import { shell } from './shell.svelte';

  const PANEL_ANIM_MS =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;

  const active = $derived(tabs.active);
  // S21: a tab opened from history says so, and links back to the saved request it came from.
  const historySnapshot = $derived.by(() => {
    const entry = active?.historyId ? history.list.find((h) => h.id === active.historyId) : undefined;
    return entry ? { entry, original: matchSaved(entry, searchRequests(workspace.tree, '', Infinity)) } : undefined;
  });
</script>

<div class="bs-workspace-shell">
  <div class="bs-workspace-main">
    <!-- Main -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <main
      class="bs-main"
      class:util-full={shell.utilityMode === 'issues' && utilityUi.expanded}
      class:req-hidden={layout.requestHidden && !layout.sideBySide}
      class:side={layout.sideBySide}
      onfocusin={layout.autoFocusIn}
      onclick={(e) => {
        if (layout.requestHidden && (e.target as HTMLElement).closest('.bs-rtab')) layout.requestHidden = false;
      }}
    >
      <AppTabBar
        onNew={() => {
          newTab();
          void tick().then(() => document.querySelector<HTMLElement>('.bs-urlbar .cm-content')?.focus());
        }}
        onContext={tabContext}
        onTabKey={tabKeydown}
      />
      {#if active && layout.requestTab && focusMode.current}<FocusBar tab={active} mode={focusMode.current} />{/if}

      {#if active}
        {#if active.protocol === 'git'}
          {#if active.git?.view === 'project'}
            <ProjectDiffView />
          {:else if active.git?.view === 'conflicts'}
            <ConflictsView />
          {:else if active.git?.view === 'merge'}
            {#key active.git.path}<MergeEditor tab={active} onClose={() => requestCloseTab(active.id)} />{/key}
          {:else if active.git?.view === 'reflog'}
            <ReflogView />
          {:else if active.git?.view === 'compare'}
            {#key `${active.git.path}..${active.git.rev}`}<CompareView tab={active} />{/key}
          {:else if active.git?.view === 'history'}
            {#key active.git.path}<FileHistoryView tab={active} />{/key}
          {:else if active.git?.view === 'graph'}
            <GraphView tab={active} />
          {:else if active.git?.view === 'stash'}
            <StashView tab={active} />
          {:else if active.git?.view === 'commit'}
            <CommitEditor onClose={() => requestCloseTab(active.id)} />
          {:else}
            <GitDiffView tab={active} />
          {/if}
        {:else if active.protocol === 'env'}
          <EnvironmentsSheet />
        {:else if active.protocol === 'runner'}
          <RunnerView />
        {:else if active.protocol === 'settings'}
          <SettingsFileView />
        {:else}
          {#if historySnapshot}
            <div class="bs-history-banner" role="status">
              <span class="material-symbols-outlined" aria-hidden="true">history</span>
              <span class="text"
                >{`${t('app.snapshot')} · ${historyDay(historySnapshot.entry.at, Date.now(), t).toLowerCase()} ${clock(historySnapshot.entry.at)}${historySnapshot.entry.envName ? ` · ${historySnapshot.entry.envName}` : ''}. ${t('app.snapshot.note')}`}</span
              >
              {#if historySnapshot.original}<button
                  type="button"
                  onclick={() => openSavedRequest(historySnapshot!.original!.node)}>{t('app.snapshot.original')}</button
                >{/if}
            </div>
          {/if}
          <RequestHeader
            tab={active}
            savedFlash={shell.savedFlash}
            onSwitch={(e) => shell.openMenu('switch', e)}
            onSmartSave={smartSave}
            onOpenSave={openSaveDialog}
            codeOpen={shell.codeOpen}
            onCode={toggleCodePanel}
          />

          {#if active.protocol === 'grpc'}
            {#key active.id}
              <GrpcEditor
                tab={active}
                bind:methodOpen={shell.grpcMethodOpen}
                onSwitch={(e) => shell.openMenu('switch', e)}
              />
            {/key}
          {:else}
            <HttpRequestEditor tab={active} bind:methodOpen={shell.httpMethodOpen} />
          {/if}
          {#if layout.reqStrip}<RequestStrip tab={active} onShow={layout.showRequest} />{/if}
          <!-- Stays mounted while hidden so open/close animates (flex-basis → 0). -->
          <div
            class="bs-resp-host"
            class:closed={layout.respStrip}
            class:no-anim={layout.panelDragging}
            style={layout.responseHeight == null || layout.requestHidden || layout.sideBySide || focusMode.current
              ? ''
              : `flex:0 0 ${layout.responseHeight}px`}
          >
            <ResponsePane
              tab={active}
              onResize={layout.startSplitDrag}
              onResetSize={layout.resetResponseSize}
              onSettings={() =>
                active.protocol === 'grpc' ? requestGrpcEditorAction(active.id, 'tls') : (shell.settingsOpen = true)}
            />
          </div>
          <!-- SC9: in the expanded script editor the results panel stands in for the strip. -->
          {#if layout.respStrip && !(focusMode.current === 'request' && scriptUi.runPanel[active.id])}<ResponseStrip
              tab={active}
              onShow={layout.showResponse}
            />{/if}
        {/if}
      {:else}
        <WelcomeView
          onNewRequest={() => newRequestHere()}
          onImport={importFrom}
          onPasteCurl={(text) => {
            newTab();
            applyCurlToActiveTab(text);
          }}
        />
      {/if}
    </main>

    {#if shell.utilityMode}
      <div
        class="bs-util-host"
        class:full={shell.utilityMode === 'issues' && utilityUi.expanded}
        transition:slide={{ duration: PANEL_ANIM_MS, axis: 'y' }}
      >
        <UtilityPanel
          mode={shell.utilityMode}
          bind:height={shell.utilityPanelHeight}
          onSelect={(mode) => (shell.utilityMode = mode)}
          onClose={() => (shell.utilityMode = null)}
          onResizeEnd={() => void saveState('utilityPanelHeight', shell.utilityPanelHeight)}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  :global(.bs) .bs-resp-host {
    transition:
      flex-basis 180ms cubic-bezier(0.33, 1, 0.68, 1),
      flex-grow 180ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s !important;
  }

  /* Until the split is dragged, the message editor gets the bigger share; the response starts at ~30%. */
  :global(:root .bs .bs-main:has(.bs-grpc-message) > .bs-resp-host:not(.closed):not([style*='flex'])) {
    flex: 0 1 30%;
    min-height: 160px;
  }

  /* A long request body must not squeeze the stacked response to nothing. */
  :global(.bs) .bs-main:not(.side) > .bs-resp-host:not(.closed) {
    min-height: 160px;
  }

  /* App shell: toolbar, workspace menu, environment picker, tab bar, status bar, layout and resizers, welcome/empty states. */
  :global(.bs) .bs-resp-host.closed {
    flex: 0 0 0px !important;
    visibility: hidden;
    margin-bottom: 0;
  }

  /* A collapsed response keeps its resize handle, so it can be dragged back open. */
  :global(:where(.bs)) .bs-resp-host.closed {
    transition:
      flex-basis 180ms cubic-bezier(0.33, 1, 0.68, 1),
      flex-grow 180ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s linear 180ms !important;
    overflow: visible;
  }

  /* Response: an inset card at the bottom of the main panel */
  :global(.bs) .bs-resp-host {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    margin: 0 10px 10px;
    border: 0;
    border-radius: 0;
    overflow: visible;
  }

  :global(:root[data-density='compact'] .bs) .bs-resp-host {
    margin: 0 8px 8px;
  }

  .bs-workspace-shell {
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: flex;
  }

  .bs-workspace-main {
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  :global(.bs) .bs-main.req-hidden > :global(.bs-resp-host) {
    flex: 1 1 0 !important;
  }

  :global(.bs) .bs-resp-host.no-anim {
    transition: none !important;
  }

  /* Main card */
  .bs-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
    border: 0;
    border-radius: var(--radius-panel);
    background: var(--color-panel);
    box-shadow: none;
    overflow: hidden;
  }

  /* Side panels are cards too */
  .bs-util-host {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    margin: 10px 0 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-panel);
    overflow: hidden;
  }

  /* CT12: Issues on the whole height (⇧⌘J); the request area steps aside. */
  .bs-util-host.full {
    flex: 1 1 auto;
    margin-top: 0;
  }

  .bs-main.util-full {
    display: none;
  }

  :global(.bs) .bs-history-banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 46px;
    margin: 4px 20px 0;
    padding: 10px 8px 10px 16px;
    border-radius: var(--radius-card);
    background: var(--color-selected);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-history-banner > :global(.material-symbols-outlined) {
    flex: none;
    font-size: 16px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-history-banner :global(.text) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .bs-history-banner :global(button) {
    flex: none;
    height: 26px;
    padding: 0 10px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-history-banner :global(button:hover) {
    background: var(--color-raised);
  }

  :global(.bs[data-focus='request']) .bs-main > :global(.bs-resp-host) {
    display: none;
  }

  :global(.bs[data-focus='response']) .bs-main > :global(.bs-resp-host) {
    flex: 1 1 0 !important;
    margin-top: 10px;
  }

  /* E7 · side by side: header and address full width, then request column | response column */
  :global(.bs) .bs-main.side {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: repeat(6, auto) auto minmax(0, 1fr);
  }

  :global(.bs) .bs-main.side > :global(*) {
    grid-column: 1 / -1;
  }

  :global(.bs) .bs-main.side > :global(.bs-resp-host) {
    grid-column: 2;
    grid-row: 7 / 9;
    min-height: 0;
    margin: 10px 10px 10px 0;
  }

  /* The response dragged all the way up: the request editor hides and the response fills the column. */
  :global(.bs) .bs-main.req-hidden :global(.bs-reqpane) {
    display: none;
  }

  :global(.bs) .bs-main.req-hidden > :global(:is(.lb-tabrow, .bs-rtabs)) {
    display: none;
  }

  :global(.bs[data-focus]) .bs-main > :global(:is(.bs-reqhead, .bs-urlbar, .lb-tabrow, .bs-rtabs, .bs-history-banner)) {
    display: none;
  }

  :global(.bs[data-focus='request']) .bs-main > :global(.bs-reqpane) {
    flex: 1 1 0;
  }

  :global(.bs[data-focus='response']) .bs-main > :global(.bs-reqpane) {
    display: none;
  }

  :global(.bs) .bs-main.side > :global(:is(.lb-tabrow, .bs-rtabs)) {
    grid-column: 1;
    grid-row: 7;
    align-self: start;
  }

  :global(.bs) .bs-main.side > :global(.bs-reqpane) {
    grid-column: 1;
    grid-row: 8;
    min-height: 0;
  }

  :global(.bs) .bs-resp-host.closed :global(.bs-resizer-row) {
    visibility: visible;
  }

  :global(.bs) .bs-resp-host.closed :global(.bs-resp) {
    outline: 0;
  }

  :global(.bs) .bs-main.side :global(.bs-resizer-row) {
    display: none;
  }
</style>
