<!--
  The popup menu card (was the global `.bs-menu` class). The caller renders the rows inside:
  `<button class="mi">` items (optional `.ic` icon, `.sc` shortcut; `.danger`, `.open`, `.hint`),
  `.lbl` section labels and `.dv` dividers. Position, role and handlers pass through as attributes.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-menu', cls]} {...rest}>{@render children?.()}</div>

<style>
  .bs-menu :global(.mi:hover .sc) {
    color: rgba(255, 255, 255, 0.85);
  }

  .bs-menu :global(:where(.mi):hover) {
    color: var(--text);
    background: var(--hover);
  }

  /* App menus (S17 context menu, S22 create menu + import submenu). */
  :global(.bs) .bs-menu {
    position: fixed;
    z-index: 80;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 0;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 16px 40px #00000080;
  }

  :global(.bs) .bs-menu :global(.dv) {
    flex: none;
    height: 9px;
    margin: 0 12px;
    background: linear-gradient(var(--color-border-subtle), var(--color-border-subtle)) center / 100% 1px no-repeat;
  }

  :global(.bs) .bs-menu :global(.mi.hint .sc) {
    font: var(--font-size-caption) var(--font-ui);
  }

  /* Popover menus, command palette, modal dialogs. */
  .bs-menu :global(.mi .ic) {
    width: 19px;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  .bs-menu :global(.mi .ic svg) {
    width: 17px;
    height: 17px;
  }

  .bs-menu :global(:where(.mi) .sc) {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--t3);
  }

  .bs-menu :global(.mi.danger) {
    color: var(--red);
  }

  .bs-menu :global(.lbl) {
    padding: 7px 10px 8px;
    color: var(--t2);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }

  .bs-menu :global(:where(.dv)) {
    height: 0.5px;
    background: var(--sepsoft);
    margin: 6px 5px;
  }

  /* Menus and dialogs stay visually close to their source control. */
  .bs-menu :global(.mi:hover .ic) {
    color: currentColor;
  }

  .bs-menu :global(.mi.danger:hover) {
    background: color-mix(in srgb, var(--red) 12%, transparent);
    color: var(--red);
  }

  /* Popover menus (create / collection actions) */
  /* Menus, dialogs and secondary surfaces */
  .bs-menu {
    position: fixed;
    z-index: 80;
    padding: 6px;
    transform-origin: top left;
    animation: bs-popover-in 120ms ease both;
    border: 1px solid var(--sep);
    border-radius: 6px;
    background: var(--surface-solid);
    box-shadow: var(--shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  :global(:where(.dark)) .bs-menu {
    background: var(--surface-solid);
  }

  .bs-menu :global(:where(.mi)) {
    display: flex;
    align-items: center;
    font-size: 13.5px;
    color: var(--text);
    width: 100%;
    text-align: left;
    min-height: 30px;
    gap: 11px;
    padding: 7px 9px;
    border-radius: 4px;
  }

  :global(.bs) .bs-menu :global(.lbl) {
    flex: none;
    height: 25px;
    margin: 0;
    padding: 8px 12px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.bs) .bs-menu :global(.mi) {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    text-align: left;
  }

  :global(.bs) .bs-menu :global(.mi .ic) {
    flex: 0 0 16px;
    width: 16px;
    font-size: 16px;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-menu :global(.mi .lb) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .bs-menu :global(.mi .sc) {
    flex: none;
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    letter-spacing: 0;
  }

  :global(.bs) .bs-menu :global(.mi:hover) {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
    outline: none;
  }

  :global(.bs) .bs-menu :global(.mi:focus-visible) {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
    outline: none;
  }

  :global(.bs) .bs-menu :global(.mi:hover .ic) {
    color: var(--color-text);
  }

  :global(.bs) .bs-menu :global(.mi:focus-visible .ic) {
    color: var(--color-text);
  }

  :global(.bs) .bs-menu :global(.mi.open) {
    background: var(--color-hover);
  }

  :global(.bs) .bs-menu :global(.mi.danger) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-menu :global(.mi.danger .ic) {
    color: var(--color-danger);
  }

  /* Disabled menu rows. */
  .bs-menu :global(.mi:disabled) {
    color: var(--color-text-muted);
    cursor: default;
    opacity: 0.55;
  }

  .bs-menu :global(.mi:disabled:hover) {
    background: transparent;
    font-weight: inherit;
  }

  .bs-menu :global(.mi.proto.grpc .ic) {
    color: var(--method-grpc);
  }

  /* S22b: the create menu tints HTTP too (the protocol switcher keeps it in text colour). */
  .bs-menu :global(.mi.proto.http.tint .ic) {
    color: var(--method-get);
  }
</style>
