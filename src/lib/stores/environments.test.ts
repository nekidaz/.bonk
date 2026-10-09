import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { addEnvironment } from './environments';
import { environments } from './state';

describe('addEnvironment', () => {
  it('suffixes a taken name so the name-based AI allow-list stays unambiguous', () => {
    const ids = [addEnvironment('Dup'), addEnvironment('Dup'), addEnvironment(' Dup ')];
    expect(
      get(environments)
        .filter((e) => ids.includes(e.id))
        .map((e) => e.name),
    ).toEqual(['Dup', 'Dup 2', 'Dup 3']);
  });
});
