<script lang="ts">
  /**
   * The editor's «Спрашивать при отправке»: the right-click menu on a `{{var}}` and, after it, the
   * field settings popover. Mounted once in the app overlays; `askUi` says which is open.
   */
  import { t } from '$shared/i18n';
  import { guessInput } from '$shared/model';
  import { askUi, inputs, setAsked } from './store.svelte';
  import AskSettings from './AskSettings.svelte';
  import { Menu, Backdrop } from '$shared/ui/components';

  const menu = $derived(askUi.menu);
  const asked = $derived(menu ? menu.name in inputs.defs : false);

  // Keep the menu inside the window.
  const WIDTH = 232;
  const left = $derived(menu ? Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8)) : 0);
  const top = $derived(menu ? Math.max(8, Math.min(menu.y, window.innerHeight - 120)) : 0);

  function enable(): void {
    if (!menu) return;
    const { name, x, y } = menu;
    setAsked(name, guessInput(name));
    // The settings open right under the pointer, where the chip just appeared.
    askUi.openSettings(name, { left: x, right: x, top: y - 8, bottom: y + 8 });
  }

  function settings(): void {
    if (!menu) return;
    const { name, x, y } = menu;
    askUi.openSettings(name, { left: x, right: x, top: y - 8, bottom: y + 8 });
  }

  function stop(): void {
    if (menu) setAsked(menu.name, null);
    askUi.close();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && (askUi.menu || askUi.settings)) {
      e.preventDefault();
      askUi.close();
    }
  }}
/>

{#if menu}
  <Backdrop type="button" aria-label={t('nav.menu.closeMenu')} onclick={() => askUi.close()} />
  <Menu role="menu" style="left:{left}px; top:{top}px; width:{WIDTH}px">
    <div class="lbl" style="text-transform: none">{`{{${menu.name}}}`}</div>
    {#if asked}
      <button class="mi" type="button" role="menuitem" onclick={settings}>
        <span class="material-symbols-outlined ic" aria-hidden="true">tune</span>
        <span class="lb">{t('input.menu.settings')}</span>
      </button>
      <button class="mi" type="button" role="menuitem" onclick={stop}>
        <span class="material-symbols-outlined ic" aria-hidden="true">block</span>
        <span class="lb">{t('input.menu.stop')}</span>
      </button>
    {:else}
      <button class="mi" type="button" role="menuitem" onclick={enable}>
        <span class="material-symbols-outlined ic" aria-hidden="true">keyboard</span>
        <span class="lb">{t('input.menu.ask')}</span>
      </button>
    {/if}
  </Menu>
{/if}

{#if askUi.settings}
  <AskSettings target={askUi.settings} />
{/if}
