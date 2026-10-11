import { persisted } from '$shared/persist';

/** G1b: how diffs are laid out, remembered across launches. */
export const diffLayout = persisted<'inline' | 'split'>(
  'gitDiffLayout',
  'inline',
  (v): v is 'inline' | 'split' => v === 'inline' || v === 'split',
);
