import { describe, expect, it } from 'vitest';
import { sessionRowActions } from './sessionRows';

describe('sessionRowActions', () => {
  it('lets a live session refresh and sign out, a dead one sign in again', () => {
    expect(sessionRowActions('ok')).toEqual({ refresh: true, signIn: false, signOut: true });
    expect(sessionRowActions('renew')).toEqual({ refresh: true, signIn: false, signOut: true });
    expect(sessionRowActions('dead')).toEqual({ refresh: false, signIn: true, signOut: false });
    expect(sessionRowActions('none')).toEqual({ refresh: false, signIn: true, signOut: false });
  });
});
