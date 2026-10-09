/**
 * Find & replace widget (E1b): a floating card at the editor's top-right, VS Code style.
 * Row 1: replace toggle · find field with Aa / ab / .* inside · «2/1200» · ↑ ↓ ✕.
 * Row 2 (toggle, editable editors only): replace field · Replace · Replace all.
 * Plugs into `search({ createPanel })`, so ⌘F, Enter / ⇧Enter, Esc and the match highlight stay CodeMirror's.
 */
import type { EditorState } from '@codemirror/state';
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';

/** Counting stops here; past it the widget shows «?/10000+». */
const COUNT_CAP = 10_000;

/** Replace row open/closed, shared by every editor for the session. */
let replaceOpen = false;

/** «current/total» for the query, current = the match the main selection sits on (0 if none). */
export function matchCount(
  state: EditorState,
  query: SearchQuery,
): { current: number; total: number; capped: boolean } {
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let m = cursor.next(); !m.done; m = cursor.next()) {
    total++;
    if (m.value.from === from && m.value.to === to) current = total;
    if (total >= COUNT_CAP) return { current, total, capped: true };
  }
  return { current, total, capped: false };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  ...kids: Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

function iconButton(cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el(
    'button',
    { type: 'button', class: `bs-find-btn ${cls}`, 'aria-label': label, title: label },
    el('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true' }, document.createTextNode(icon)),
  );
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field
  b.addEventListener('click', onClick);
  return b;
}

export function createFindPanel(view: EditorView): Panel {
  const p = (s: string) => view.state.phrase(s);
  const editable = !view.state.readOnly;
  let query = getSearchQuery(view.state);

  const find = el('input', {
    class: 'bs-find-input',
    'main-field': 'true',
    placeholder: p('Find'),
    'aria-label': p('Find'),
    spellcheck: 'false',
  });
  const repl = el('input', {
    class: 'bs-find-input',
    placeholder: p('Replace'),
    'aria-label': p('Replace'),
    spellcheck: 'false',
  });
  const count = el('span', { class: 'bs-find-count', 'aria-live': 'polite' });

  const flag = (icon: string, label: string, key: 'caseSensitive' | 'wholeWord' | 'regexp') => {
    const b = iconButton('bs-find-flag', icon, label, () => commit({ [key]: !query[key] }));
    b.dataset.flag = key;
    return b;
  };
  const flags = [
    flag('match_case', p('match case'), 'caseSensitive'),
    flag('match_word', p('by word'), 'wholeWord'),
    flag('regular_expression', p('regexp'), 'regexp'),
  ];

  const toggle = iconButton('bs-find-toggle', 'keyboard_arrow_down', p('Toggle Replace'), () => {
    replaceOpen = !replaceOpen;
    render();
    (replaceOpen ? repl : find).focus();
  });
  const replaceRow = el(
    'div',
    { class: 'bs-find-row bs-find-replace' },
    el('span', { class: 'bs-find-indent' }),
    el('label', { class: 'bs-find-field' }, repl),
    iconButton('', 'find_replace', p('replace'), () => replaceNext(view)),
    iconButton('', 'done_all', p('replace all'), () => replaceAll(view)),
  );

  const dom = el(
    'div',
    { class: 'cm-search bs-find' },
    el(
      'div',
      { class: 'bs-find-row' },
      editable ? toggle : el('span', { class: 'bs-find-indent' }),
      el('label', { class: 'bs-find-field' }, find, ...flags),
      count,
      iconButton('', 'arrow_upward', p('previous'), () => findPrevious(view)),
      iconButton('', 'arrow_downward', p('next'), () => findNext(view)),
      iconButton('', 'close', p('close'), () => closeSearchPanel(view)),
    ),
    ...(editable ? [replaceRow] : []),
  );

  function commit(patch: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}): void {
    const next = new SearchQuery({
      search: find.value,
      replace: repl.value,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      ...patch,
    });
    if (next.eq(query)) return;
    query = next;
    view.dispatch({ effects: setSearchQuery.of(next) });
  }

  function render(): void {
    for (const b of flags) b.classList.toggle('on', query[b.dataset.flag as 'caseSensitive'] === true);
    toggle.classList.toggle('open', replaceOpen);
    toggle.setAttribute('aria-expanded', String(replaceOpen));
    replaceRow.hidden = !replaceOpen;
    find.parentElement!.classList.toggle('bad', !!query.search && !query.valid);
    if (!query.search || !query.valid) {
      count.textContent = '';
      return;
    }
    const { current, total, capped } = matchCount(view.state, query);
    count.textContent = capped ? `?/${COUNT_CAP}+` : `${current}/${total}`;
    count.classList.toggle('none', total === 0);
  }

  find.value = query.search;
  repl.value = query.replace;
  find.addEventListener('input', () => commit());
  repl.addEventListener('input', () => commit());
  dom.addEventListener('keydown', (e) => {
    if (runScopeHandlers(view, e, 'search-panel')) e.preventDefault();
    else if (e.key === 'Enter' && e.target === find) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === 'Enter' && e.target === repl) {
      e.preventDefault();
      (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(view);
    }
  });
  render();

  return {
    dom,
    top: true,
    mount: () => find.select(),
    update(u: ViewUpdate) {
      for (const tr of u.transactions)
        for (const e of tr.effects)
          if (e.is(setSearchQuery) && !e.value.eq(query)) {
            query = e.value;
            find.value = query.search;
            repl.value = query.replace;
          }
      if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery))))
        render();
    },
  };
}
