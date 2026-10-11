import { describe, it, expect } from 'vitest';
import { messageParts } from './commitMessage';

describe('messageParts', () => {
  it('splits the subject from the rest, ignoring trailing blank lines', () => {
    expect(messageParts('Fix\n\n- a\n- b\n\n')).toEqual({ subject: 'Fix', more: 3 });
    expect(messageParts('One line')).toEqual({ subject: 'One line', more: 0 });
  });
});
