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
          <EnvironmentsSheet embedded />
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
