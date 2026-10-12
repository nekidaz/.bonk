import { t } from '$shared/i18n';
import type { SessionPrompt } from './types';
import { findVariables } from './vars';

/**
 * «Ask on send» variables: a definition per variable name (`.bonk/inputs.json`), the form field
 * it becomes, and the same checks bonk-core runs (`domain/inputs.rs`) so the form can refuse a
 * bad value before it is sent. The typed value lives only in the run.
 */

export type InputKind = 'text' | 'number' | 'code' | 'secret' | 'select' | 'bool' | 'json' | 'file';

/** Mirrors `InputDef` in bonk-core; the backend sends every field. */
export interface InputDef {
  type: InputKind;
  label: string;
  hint: string;
  required: boolean;
  default: string;
  /** Fill the form with the value of the last send (never for a secret). */
  remember: boolean;
  /** Mask the value in the form and the log whatever its type (`secret` always is). */
  secret: boolean;
  /** `select`: the variants. */
  options: string[];
  /** `text`: a regex the whole value must match. */
  pattern: string;
  min: number | null;
  max: number | null;
  step: number | null;
  /** `code`: how many cells (0 = 6). */
  length: number;
}

export const INPUT_KINDS: InputKind[] = ['text', 'number', 'code', 'secret', 'select', 'bool', 'json', 'file'];

/** The Material symbol of each type (the form header and the type menu). */
export const INPUT_ICON: Record<InputKind, string> = {
  text: 'match_case',
  number: '123',
  code: 'pin',
  secret: 'password',
  select: 'list',
  bool: 'toggle_on',
  json: 'data_object',
  file: 'upload_file',
};

export function newInput(type: InputKind = 'code'): InputDef {
  return {
    type,
    label: '',
    hint: '',
    required: true,
    default: '',
    remember: false,
    secret: false,
    options: type === 'select' ? ['KZT', 'USD'] : [],
    pattern: '',
    min: null,
    max: null,
    step: null,
    length: type === 'code' ? 6 : 0,
  };
}

/** A first guess at the field for a variable name: `otp` is a code, `cvc` a secret, `amount` a number. */
export function guessInput(name: string): InputDef {
  const n = name.toLowerCase();
  if (/otp|sms|pin|code|2fa|mfa/.test(n)) return newInput('code');
  if (/pass|secret|token|cvc|cvv|key/.test(n)) return newInput('secret');
  if (/amount|sum|count|qty|quantity|limit|price|num/.test(n)) return newInput('number');
  return newInput('text');
}

/** Quick «Формат» choices of the first popover: a type, optionally with its size. */
export const INPUT_FORMATS: { id: string; type: InputKind; length?: number }[] = [
  { id: 'code6', type: 'code', length: 6 },
  { id: 'code4', type: 'code', length: 4 },
  { id: 'text', type: 'text' },
  { id: 'number', type: 'number' },
  { id: 'secret', type: 'secret' },
  { id: 'bool', type: 'bool' },
];

export function codeLength(def: InputDef): number {
  return def.length > 0 ? def.length : 6;
}

/** Codes and secrets are masked in logs, history and the sent-request view. */
export function isSensitive(def: InputDef): boolean {
  return def.secret || def.type === 'code' || def.type === 'secret';
}

/** What a log shows instead of `value`: `••••13` for a code, `••••` for a secret. */
export function maskInput(def: InputDef, value: string): string {
  const chars = [...value];
  if (def.type === 'secret' || def.secret || chars.length <= 4) return '••••';
  return `••••${chars.slice(-2).join('')}`;
}

/** The value as it is substituted: a number loses its group separators (`25 000`). */
export function normalizeInput(def: InputDef, value: string): string {
  return def.type === 'number' ? value.replace(/\s+/g, '').replace(',', '.') : value;
}

/** Why `value` (already normalized) can't be sent, or null when it can. */
export function checkInput(def: InputDef, value: string): string | null {
  if (value === '') return def.required ? t('input.err.required') : null;
  switch (def.type) {
    case 'text': {
      if (!def.pattern) return null;
      try {
        return new RegExp(`^(?:${def.pattern})$`).test(value) ? null : t('input.err.pattern', { pattern: def.pattern });
      } catch {
        return t('input.err.badPattern');
      }
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return t('input.err.nan');
      if (def.min !== null && n < def.min) return t('input.err.min', { n: def.min });
      if (def.max !== null && n > def.max) return t('input.err.max', { n: def.max });
      if (def.step !== null && def.step > 0) {
        const ratio = (n - (def.min ?? 0)) / def.step;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return t('input.err.step', { n: def.step });
      }
      return null;
    }
    case 'code': {
      const n = codeLength(def);
      return [...value].length === n && /^[\p{L}\p{N}]+$/u.test(value) ? null : t('input.err.code', { n });
    }
    case 'select':
      return def.options.length === 0 || def.options.includes(value) ? null : t('input.err.option');
    case 'bool':
      return value === 'true' || value === 'false' ? null : t('input.err.bool');
    case 'json':
      try {
        JSON.parse(value);
        return null;
      } catch (e) {
        return t('input.err.json', { why: e instanceof Error ? e.message : String(e) });
      }
    default:
      return null;
  }
}

/** The label a form shows: the given one, else the variable's name. */
export function inputLabel(name: string, def: InputDef): string {
  return def.label.trim() || name;
}

/** The «ask on send» variables `node` uses, in order of appearance (like bonk-core's `input_fields`). */
export function inputNamesOf(node: unknown, defs: Record<string, InputDef>): string[] {
  if (Object.keys(defs).length === 0) return [];
  const seen: string[] = [];
  for (const match of findVariables(JSON.stringify(node) ?? '')) {
    if (match.name in defs && !seen.includes(match.name)) seen.push(match.name);
  }
  return seen;
}

/** One field of an input form: the variable and how it is asked. */
export type InputField = InputDef & { name: string };

/** What the previous try of the step got back (a rejected code), shown above the form. */
export interface InputAttempt {
  status: number | string;
  message: string;
  elapsedMs: number;
  /** That try's input, masked as the log shows it. */
  inputs: Record<string, string>;
}

/** A step waiting for typed input (`runner::InputRequest`). */
export interface InputRequest {
  /** The answer goes back under this id. */
  id: string;
  nodeId: string;
  requestName: string;
  method: string;
  iteration: number;
  fields: InputField[];
  attempt: number;
  maxAttempts: number;
  error?: string;
  last?: InputAttempt;
  /** Set when a session's sign-in asks: which scenario, how far it got (Flow · Сессия SE5). */
  session?: SessionPrompt;
}

export type InputAnswer = { kind: 'values'; values: Record<string, string> } | { kind: 'skip' } | { kind: 'stop' };
