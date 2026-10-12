import { untrack } from 'svelte';
import { t } from '$shared/i18n';
import { inputsLoad, inputsSave, runnerInputAnswer } from '$shared/ipc';
import { isSensitive, type InputAnswer, type InputDef, type InputField, type InputRequest } from '$shared/model';
import { persisted } from '$shared/persist';

/**
 * «Ask on send» variables of the workspace (`.bonk/inputs.json`, committed with the requests):
 * which `{{names}}` are typed by hand at send time and how each field looks. The typed values
 * never land here, in the environments or in history; only the form's last value is
 * remembered for fields that ask for it, and never a code or a secret.
 */
class Inputs {
  /** Definition by variable name. */
  defs = $state.raw<Record<string, InputDef>>({});
  /** The open workspace the definitions belong to ('' = none); set by `watchInputs`. */
  root = '';
  error = $state('');
}
export const inputs = new Inputs();

/** The `{{var}}` an editor chip or menu points at. */
export const isAsked = (name: string): boolean => name in inputs.defs;

let saving: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** When the definitions were last edited here; a disk reload right after would undo typing. */
let editedAt = 0;
// ponytail: a time window, not write tracking; an outside edit within it waits for the next one.
const EDIT_QUIET_MS = 1500;

/** Ask for `name` with `def`, or stop asking (`null`); writes `.bonk/inputs.json` soon after. */
export function setAsked(name: string, def: InputDef | null): void {
  const next = { ...untrack(() => inputs.defs) };
  if (def) next[name] = def;
  else delete next[name];
  inputs.defs = next;
  editedAt = Date.now();
  const root = inputs.root;
  if (!root) return;
  // Typing a label saves on every key: wait for a pause, and write one at a time, in order.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = untrack(() => inputs.defs);
    saving = saving
      .then(() => inputsSave(root, snapshot))
      .catch((e) => {
        inputs.error = t('input.set.saveFailed', { error: String(e) });
      });
  }, 200);
}

/**
 * Workspace changes reload the definitions; lifecycle owns this watcher and passes the open
 * workspace's path (entities/workspace imports the environments, which import this slice).
 */
export function watchInputs(workspacePath: () => string | null, diskRev: () => number = () => 0): () => void {
  return $effect.root(() => {
    $effect(() => {
      const root = workspacePath();
      inputs.root = root ?? '';
      inputs.defs = {};
      if (!root) return;
      let cancelled = false;
      void inputsLoad(root)
        .then((defs) => {
          if (!cancelled) inputs.defs = defs;
        })
        .catch((e) => {
          if (!cancelled) inputs.error = String(e);
        });
      return () => {
        cancelled = true;
      };
    });
    // `.bonk/inputs.json` changed on disk (bonk MCP, git): re-read it unless it is being edited here.
    $effect(() => {
      if (diskRev() === 0) return;
      const root = untrack(() => inputs.root);
      const quiet = () => Date.now() - editedAt >= EDIT_QUIET_MS;
      if (!root || !quiet()) return;
      void inputsLoad(root)
        .then((defs) => {
          if (inputs.root === root && quiet()) inputs.defs = defs;
        })
        .catch((e) => {
          inputs.error = String(e);
        });
    });
  });
}

/** Last typed value per variable name, for fields with «Подставлять прошлое значение». */
const lastValues = persisted<Record<string, string>>('inputLastValues', {});

/** The form's starting value of `field`: the remembered one, else the default. */
export function initialValue(field: InputField): string {
  const last = field.remember && !isSensitive(field) ? lastValues.current[field.name] : undefined;
  return last ?? field.default;
}

/** The value remembered for `field` (shown as «прошлое: KZT»). */
export function lastValue(field: InputField): string | undefined {
  return field.remember && !isSensitive(field) ? lastValues.current[field.name] : undefined;
}

/** Keep what was sent in the fields that ask to be prefilled next time. */
export function rememberValues(fields: InputField[], values: Record<string, string>): void {
  const next = { ...lastValues.current };
  let changed = false;
  for (const field of fields) {
    if (!field.remember || isSensitive(field) || !(field.name in values)) continue;
    next[field.name] = values[field.name];
    changed = true;
  }
  if (changed) lastValues.current = next;
}

/** Where the right-click menu and the field settings popover of an editor `{{var}}` are open. */
type Rect = { left: number; right: number; top: number; bottom: number };
class AskUi {
  menu = $state.raw<{ name: string; x: number; y: number } | null>(null);
  settings = $state.raw<({ name: string } & Rect) | null>(null);

  openMenu(name: string, at: { x: number; y: number }): void {
    this.settings = null;
    this.menu = { name, ...at };
  }

  openSettings(name: string, rect: Rect): void {
    this.menu = null;
    this.settings = { name, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }

  close(): void {
    this.menu = null;
    this.settings = null;
  }
}
export const askUi = new AskUi();

/** The form an editor send waits on, by request id (the Runner keeps its own in the run state). */
class Prompts {
  byRequest = $state.raw<Record<string, InputRequest>>({});
}
export const inputPrompts = new Prompts();

export function openPrompt(requestId: string, request: InputRequest): void {
  inputPrompts.byRequest = { ...untrack(() => inputPrompts.byRequest), [requestId]: request };
}

export function closePrompt(requestId: string): void {
  const current = untrack(() => inputPrompts.byRequest);
  if (!(requestId in current)) return;
  const { [requestId]: _closed, ...rest } = current;
  inputPrompts.byRequest = rest;
}

/** Reply to a form (the editor's or the Runner's): send the answer and remember what was typed. */
export async function answerInput(request: InputRequest, answer: InputAnswer): Promise<void> {
  if (answer.kind === 'values') rememberValues(request.fields, answer.values);
  await runnerInputAnswer(request.id, answer);
}
