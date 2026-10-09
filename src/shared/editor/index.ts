// Public API of shared/editor (like the exported names of a Go package).
// Code outside src/shared/editor/ imports only from here; files inside use relative paths.

export { errorFieldLines } from './errorLines';
export { esc, formatMarkup, highlightJson, highlightMarkup, hl, lineNumbers, MAX_HIGHLIGHT_CHARS } from './highlight';
export { bodyPlaceholder, jsonErrorMessage, parseJsonForBeautify } from './jsonEditor';
export { jsonProblem } from './jsonLint';
export {
  applyBodyKind,
  beautify,
  BEAUTIFY_MAX_CHARS,
  type BodyKind,
  bodyKindLabel,
  bodyKindOf,
  isLargeBody,
  OTHER_KINDS,
  RAW_KINDS,
  textStats,
  type TextStats,
} from './largeBody';
export { countLabel } from './largeFold';
export { urlHighlight } from './urlHighlight';
