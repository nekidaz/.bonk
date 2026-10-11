/**
 * Svelte action (`use:portal`): move the node to <body>, out of any transformed or clipping
 * ancestor, so a popover over a sheet is neither cut off nor positioned against the sheet.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
