import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from './releaseNotes';

describe('parseReleaseNotes', () => {
  it('reads Keep a Changelog sections, bold titles and wrapped bullets', () => {
    const md = [
      '### Added',
      '- **Flows**: a node canvas that chains',
      '  saved requests.',
      '- Tooltip on truncated `names`.',
      '',
      '### Fixed',
      '* `DELETE` badges no longer clip.',
      '',
      'See [CHANGELOG.md](https://example.com) for details.',
    ].join('\n');
    expect(parseReleaseNotes(md)).toEqual([
      { kind: 'added', title: 'Flows', desc: 'a node canvas that chains saved requests.' },
      { kind: 'added', title: 'Tooltip on truncated names.', desc: '' },
      { kind: 'fixed', title: 'DELETE badges no longer clip.', desc: '' },
    ]);
  });

  it('yields nothing for notes without bullets', () => {
    expect(parseReleaseNotes('See CHANGELOG.md for details.')).toEqual([]);
  });
});
