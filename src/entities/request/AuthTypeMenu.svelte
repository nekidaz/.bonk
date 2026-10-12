<script lang="ts">
  import { t } from '$shared/i18n';
  import { portal } from '$shared/ui';
  import type { AuthType } from '$shared/model';

  // OA1: the auth type picker. Not a native <select>: macOS draws that menu itself, without the
  // icons, the «новое» mark and the hints of OAuth and Session. The menu lives in <body> (rows clip what overflows).
  let {
    options,
    value,
    label,
    onSelect,
  }: {
    options: { key: AuthType; label: string; icon: string }[];
    value: AuthType;
    /** What the closed picker shows (an inherited type is not among `options`). */
    label: string;
    onSelect: (type: AuthType) => void;
  } = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let pos = $state('');

  function toggle(): void {
    if (!open && trigger) {
      const r = trigger.getBoundingClientRect();
      // Below the picker when it fits, else above it (the folder dialog sits low).
      pos =
        window.innerHeight - r.bottom > 280
          ? `top:${r.bottom + 6}px;left:${r.left}px`
          : `bottom:${window.innerHeight - r.top + 6}px;left:${r.left}px`;
    }
    open = !open;
  }
  function choose(type: AuthType): void {
    open = false;
    trigger?.focus();
    if (type !== value) onSelect(type);
  }
  function close(): void {
    open = false;
  }

  $effect(() => {
    if (!open || !menu) return;
    (menu.querySelector<HTMLButtonElement>('button.on') ?? menu.querySelector('button'))?.focus();
    // Anything scrolling under a fixed menu would leave it floating in the wrong place.
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  });

  function keydown(e: KeyboardEvent): void {
    if (!menu) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      trigger?.focus();
    }
  }
</script>

<svelte:window onpointerdown={close} onresize={close} />

<span class="bs-auth-select" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    bind:this={trigger}
    class="trigger"
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={t('http.auth.type_aria')}
    onclick={toggle}>{label}</button
  >
  <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
</span>

{#if open}
  <div
    use:portal
    bind:this={menu}
    class="bs-auth-menu"
    role="menu"
    tabindex="-1"
    aria-label={t('http.auth.type_aria')}
    style={pos}
    onpointerdown={(e) => e.stopPropagation()}
    onkeydown={keydown}
  >
    {#each options as o (o.key)}
      {#if o.key === 'oauth2'}<div class="dv" role="separator"></div>{/if}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={o.key === value}
        class:on={o.key === value}
        onclick={() => choose(o.key)}
      >
        <span class="material-symbols-outlined ic" aria-hidden="true">{o.icon}</span>
        <span class="t">{o.label}</span>
        {#if o.key === 'oauth2' || o.key === 'session'}<span class="new">{t('http.auth.new')}</span>{/if}
        {#if o.key === value}<span class="material-symbols-outlined check" aria-hidden="true">check</span>{/if}
      </button>
      {#if o.key === 'oauth2'}<div class="hint">{t('http.auth.oauth2.menu_hint')}</div>{/if}
      {#if o.key === 'session'}<div class="hint">{t('session.menu_hint')}</div>{/if}
    {/each}
  </div>
{/if}
