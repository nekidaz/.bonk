<script lang="ts">
  import {
    addFolder,
    clearHistory,
    collections,
    historyLimit,
    historyPaused,
    openSavedRequest,
  } from '../stores';
  import { findNode } from '../domain/tree';
  import { appMenuWidth, type AppMenuState, type RequestProtocol } from '../domain/appShell';

  type TypeRow = { label: string; icon: string; color: string; go?: () => void };

  let {
    menu,
    closeMenu,
    onPick,
    onSwitch,
    onAddRequest,
    onAddFolder,
    onSaveHere,
    onRename,
    onDuplicate,
    onMove,
    onDelete,
  }: {
    menu: AppMenuState;
    closeMenu: () => void;
    onPick: (kind: RequestProtocol) => void;
    onSwitch: (kind: RequestProtocol) => void;
    onAddRequest: (kind: RequestProtocol) => void;
    onAddFolder: () => void;
    onSaveHere: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onMove: () => void;
    onDelete: () => void;
  } = $props();

  const reqTypes: TypeRow[] = [
    { label: 'HTTP', icon: 'language', color: '#2aa3ff', go: () => onPick('http') },
    { label: 'GraphQL', icon: 'hub', color: '#e535ab' },
    { label: 'AI', icon: 'auto_awesome', color: '#34c759' },
    { label: 'MCP', icon: 'deployed_code', color: '#14b8a6' },
    { label: 'gRPC', icon: 'lan', color: '#4a8cff', go: () => onPick('grpc') },
    { label: 'WebSocket', icon: 'power', color: '#f1841a' },
    { label: 'Socket.IO', icon: 'bolt', color: '#f1841a' },
    { label: 'MQTT', icon: 'rss_feed', color: '#8a52e0' },
  ];

  const switchTypes: TypeRow[] = reqTypes
    .map((r) => ({
      ...r,
      go: r.label === 'HTTP' ? () => onSwitch('http') : r.label === 'gRPC' ? () => onSwitch('grpc') : undefined,
    }));

  const wsItems = ['Collection', 'Environment', 'Spec', 'Mock Server', 'Monitor', 'Webhook', 'Insights', 'Flow'];
  const wsIcons: Record<string, string> = {
    Collection: 'folder',
    Environment: 'layers',
    Spec: 'description',
    'Mock Server': 'dns',
    Monitor: 'monitor_heart',
    Webhook: 'webhook',
    Insights: 'insights',
    Flow: 'account_tree',
  };
  const historyLimits: { label: string; value: number }[] = [
    { label: '50', value: 50 },
    { label: '100', value: 100 },
    { label: '200', value: 200 },
    { label: '500', value: 500 },
    { label: '1000', value: 1000 },
    { label: 'All', value: 0 },
  ];

  function addRootFolder(): void {
    void addFolder();
    closeMenu();
  }

  function openRequest(): void {
    const n = menu.nodeId ? findNode($collections, menu.nodeId) : undefined;
    if (n && n.kind === 'request') openSavedRequest(n);
    closeMenu();
  }
</script>

{#if menu.kind}
  <button class="bs-backdrop" aria-label="Close menu" onclick={closeMenu}></button>
  <div class="bs-menu" style="left:{menu.x}px; top:{menu.y}px; width:{appMenuWidth(menu.kind)}px">
    {#if menu.kind === 'create'}
      <div class="srch"><span class="material-symbols-outlined" style="font-size:13px">search</span>Search…</div>
      <button class="mi"><span class="ic" style="color:#a78bfa"><span class="material-symbols-outlined" style="font-size:17px">auto_awesome</span></span>Ask AI<span class="sc">⌃⌥P</span></button>
      <div class="dv"></div>
      {#each reqTypes as r (r.label)}
        <button class="mi" class:soon={!r.go} onclick={() => r.go && r.go()}>
          <span class="ic" style="color:{r.color}"><span class="material-symbols-outlined" style="font-size:17px">{r.icon}</span></span>{r.label}
          {#if !r.go}<span class="soonpill">SOON</span>{/if}
        </button>
      {/each}
      <div class="dv"></div>
      {#each wsItems as w (w)}
        {#if w === 'Collection'}
          <button class="mi" onclick={addRootFolder}><span class="ic"><span class="material-symbols-outlined" style="font-size:17px">folder</span></span>Collection</button>
        {:else}
          <button class="mi soon"><span class="ic"><span class="material-symbols-outlined" style="font-size:17px">{wsIcons[w]}</span></span>{w}<span class="soonpill">SOON</span></button>
        {/if}
      {/each}
    {:else if menu.kind === 'switch'}
      <div class="lbl">Switch request type</div>
      <div class="dv" style="margin-top:0"></div>
      {#each switchTypes as r (r.label)}
        <button class="mi" class:soon={!r.go} onclick={() => r.go && r.go()}>
          <span class="ic" style="color:{r.color}"><span class="material-symbols-outlined" style="font-size:17px">{r.icon}</span></span>{r.label}
          {#if !r.go}<span class="soonpill">SOON</span>{/if}
        </button>
      {/each}
    {:else if menu.kind === 'coll'}
      <button class="mi" onclick={() => onAddRequest('http')}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">language</span></span>Add HTTP request</button>
      <button class="mi" onclick={() => onAddRequest('grpc')}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">lan</span></span>Add gRPC request</button>
      <div class="dv"></div>
      <button class="mi" onclick={onAddFolder}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">create_new_folder</span></span>New Folder</button>
      {#if menu.nodeId}
        <button class="mi" onclick={onSaveHere}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">note_add</span></span>Save Request Here<span class="sc">⌘S</span></button>
        <div class="dv"></div>
        <button class="mi" onclick={onRename}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">edit</span></span>Rename</button>
        <button class="mi" onclick={onDuplicate}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">content_copy</span></span>Duplicate</button>
        <button class="mi" onclick={onMove}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">drive_file_move</span></span>Move…</button>
        <div class="dv"></div>
        <button class="mi danger" onclick={onDelete}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">delete</span></span>Delete</button>
      {/if}
    {:else if menu.kind === 'req'}
      <button class="mi" onclick={onRename}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">edit</span></span>Rename Request</button>
      <button class="mi" onclick={openRequest}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">open_in_new</span></span>Open</button>
      <button class="mi" onclick={onDuplicate}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">content_copy</span></span>Duplicate</button>
      <button class="mi" onclick={onMove}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">drive_file_move</span></span>Move…</button>
      <div class="dv"></div>
      <button class="mi danger" onclick={onDelete}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">delete</span></span>Delete</button>
    {:else if menu.kind === 'history'}
      <button class="mi" onclick={() => { historyPaused.set(!$historyPaused); closeMenu(); }}>
        <span class="ic"><span class="material-symbols-outlined" style="font-size:16px">{$historyPaused ? 'play_arrow' : 'pause'}</span></span>{$historyPaused ? 'Resume recording' : 'Pause recording'}
      </button>
      <button class="mi danger" onclick={() => { clearHistory(); closeMenu(); }}><span class="ic"><span class="material-symbols-outlined" style="font-size:16px">delete_sweep</span></span>Clear history</button>
      <div class="dv"></div>
      <div class="lbl">Keep last</div>
      {#each historyLimits as opt (opt.value)}
        <button class="mi" onclick={() => { historyLimit.set(opt.value); closeMenu(); }}>
          <span class="ic"></span>{opt.label}
          {#if $historyLimit === opt.value}<span class="material-symbols-outlined" style="font-size:16px;margin-left:auto">check</span>{/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}
