import { describe, expect, it } from 'vitest';
import { DYNAMIC_VARS, nearestDynamic, searchDynamic, unknownDynamicCount } from './dynamicVars';

describe('dynamic variables catalog', () => {
  it('suggests the closest name for a typo, nothing for gibberish', () => {
    expect(nearestDynamic('$randomEmial')).toBe('$randomEmail');
    expect(nearestDynamic('$GUID')).toBe('$guid');
    expect(nearestDynamic('$isoTimestmp')).toBe('$isoTimestamp');
    expect(nearestDynamic('$zzzzzzzz')).toBeUndefined();
  });

  it('counts only unknown {{$…}} names', () => {
    expect(unknownDynamicCount('{{$guid}} {{baseUrl}} {{$randomEmial}} {{ $nope }}')).toBe(2);
  });

  it('searches by name and by description', () => {
    const describe = (name: string) => (name === '$randomEmail' ? 'Электронная почта' : '');
    expect(searchDynamic('почта', describe).map((v) => v.name)).toEqual(['$randomEmail']);
    expect(searchDynamic('$guid', describe).map((v) => v.name)).toEqual(['$guid']);
    expect(searchDynamic(' ', describe)).toBe(DYNAMIC_VARS);
  });
});
