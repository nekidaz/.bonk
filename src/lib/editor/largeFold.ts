/**
 * CodeMirror glue for JSON folding (E1/E4 rule 4): the «ещё N объектов · M строк» chip, a fold gutter, and
 * helpers that fold the middle of big arrays / everything. Range computation lives in jsonFold.ts (pure).
 */
import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { codeFolding, foldEffect, foldGutter, foldedRanges, unfoldAll as cmUnfoldAll } from '@codemirror/language';
import { get } from 'svelte/store';
import { describeSlice, scanFolds, type ItemKind } from './jsonFold';
import { plural, t } from '../i18n';
import { foldArraysOver, uiLanguage } from '../stores/prefs';

const UNITS: Record<ItemKind | 'lines' | 'matches', [[string, string, string], [string, string]]> = {
  objects: [['объект', 'объекта', 'объектов'], ['object', 'objects']],
  arrays: [['массив', 'массива', 'массивов'], ['array', 'arrays']],
  items: [['элемент', 'элемента', 'элементов'], ['item', 'items']],
  lines: [['строка', 'строки', 'строк'], ['line', 'lines']],
  matches: [['совпадение', 'совпадения', 'совпадений'], ['match', 'matches']],
};

/** `4 817` / `4,817`. */
export function formatCount(n: number, lang = get(uiLanguage)): string {
  return n.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');
}

/** `4 817 строк`, `3 objects` — a count with its plural unit in the UI language. */
export function countLabel(n: number, unit: keyof typeof UNITS, lang = get(uiLanguage)): string {
  const [ru, en] = UNITS[unit];
  return `${formatCount(n, lang)} ${plural(n, lang === 'ru' ? ru : en, lang)}`;
}

interface Prepared {
  /** Elements hidden; undefined for a plain whole-container fold. */
  count?: number;
  kind: ItemKind;
  lines: number;
}

function chipText(p: Prepared): string {
  const lines = countLabel(p.lines, 'lines');
  if (p.count === undefined) return `… ${lines}`;
  const lang = get(uiLanguage);
  const [ru, en] = UNITS[p.kind];
  return `${get(t)('lb.more', { n: formatCount(p.count, lang), unit: plural(p.count, lang === 'ru' ? ru : en, lang) })} · ${lines}`;
}

function prepare(state: EditorState, range: { from: number; to: number }): Prepared {
  const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number;
  // A large-array fold starts right after a comma (kept head element before it); a whole-container fold after a bracket.
  const partial = range.from > 0 && state.sliceDoc(range.from - 1, range.from) === ',';
  if (!partial) return { kind: 'items', lines };
  const { count, kind } = describeSlice(state.sliceDoc(range.from, range.to));
  return { count, kind, lines };
}

export function largeFolding(): Extension {
  return [
    codeFolding({
      preparePlaceholder: (state, range) => prepare(state, range),
      placeholderDOM(_view, onclick, prepared) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cm-foldPlaceholder bs-fold-chip';
        el.textContent = chipText(prepared as Prepared);
        el.onclick = onclick;
        return el;
      },
    }),
    foldGutter({
      markerDOM(open) {
        const el = document.createElement('span');
        el.className = 'material-symbols-outlined bs-fold-mark';
        el.textContent = open ? 'expand_more' : 'chevron_right';
        return el;
      },
    }),
  ];
}

/** Fold the middle of every big array (keeps first 2 + last 2 items). Returns how many folds were added. */
export function foldLargeArrays(view: EditorView, text?: string): number {
  const { large } = scanFolds(text ?? view.state.doc.toString(), { min: get(foldArraysOver) });
  if (large.length) view.dispatch({ effects: large.map((f) => foldEffect.of({ from: f.from, to: f.to })) });
  return large.length;
}

/** Fold every multi-line object/array except the root. */
export function foldEverything(view: EditorView): void {
  const { containers } = scanFolds(view.state.doc.toString(), { containers: true });
  if (containers.length) view.dispatch({ effects: containers.map((f) => foldEffect.of({ from: f.from, to: f.to })) });
}

export function unfoldEverything(view: EditorView): void {
  cmUnfoldAll(view);
}

export const hasFolds = (state: EditorState): boolean => foldedRanges(state).iter().value !== null;

/** «Свернуть всё» toggles: unfold when anything is folded, else fold every container. */
export function toggleFoldAll(view: EditorView): void {
  if (hasFolds(view.state)) unfoldEverything(view);
  else foldEverything(view);
}
