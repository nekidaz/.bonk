import { persisted } from '$shared/persist';

/** G1b: how diffs are laid out, remembered across launches. */
export const diffLayout = persisted<'inline' | 'split'>(
  'gitDiffLayout',
  'inline',
  (v): v is 'inline' | 'split' => v === 'inline' || v === 'split',
);

/** G8: merge a conflicted request line by line («JSON») or field by field («Поля»), remembered. */
export const mergeMode = persisted<'json' | 'fields'>(
  'gitMergeMode',
  'json',
  (v): v is 'json' | 'fields' => v === 'json' || v === 'fields',
);
