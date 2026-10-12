// Public API of entities/input (like the exported names of a Go package).
// Code outside src/entities/input/ imports only from here; files inside use relative paths.

export {
  answerInput,
  askUi,
  closePrompt,
  inputPrompts,
  openPrompt,
  initialValue,
  inputs,
  isAsked,
  lastValue,
  rememberValues,
  setAsked,
  watchInputs,
} from './store.svelte';
