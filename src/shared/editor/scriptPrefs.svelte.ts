import { persisted } from '$shared/persist';

/** SC8: width of the «Структура» panel; 0 = folded into the 36 px rail. */
export const scriptOutlineWidth = persisted('scriptOutlineWidth', 252);
/** SC1: the snippets panel next to the script editor. */
export const scriptSnippetsOpen = persisted('scriptSnippetsOpen', true);
/** SC8: snippets in the expanded editor (off by default: the outline takes the side). */
export const scriptSnippetsExpanded = persisted('scriptSnippetsExpanded', false);
