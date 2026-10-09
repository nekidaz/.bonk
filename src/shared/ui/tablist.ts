/** Target index for a tablist key press, or undefined when the key isn't navigation. */
export function nextTabIndex(key: string, i: number, n: number): number | undefined {
  const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 } as Record<string, number>)[key];
  return next === undefined ? undefined : (next + n) % n;
}

/** Svelte action for `role="tablist"`: arrow/Home/End move focus, and activation follows focus. */
export function tablist(node: HTMLElement) {
  function onKeydown(e: KeyboardEvent): void {
    const tabs = [...node.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? undefined : nextTabIndex(e.key, i, tabs.length);
    if (next === undefined) return;
    e.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }
  node.addEventListener('keydown', onKeydown);
  return { destroy: () => node.removeEventListener('keydown', onKeydown) };
}
