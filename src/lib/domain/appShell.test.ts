import { describe, expect, it } from 'vitest';
import { snapPanelSize } from './appShell';

describe('snapPanelSize', () => {
  it('collapses after the snap threshold', () => {
    expect(snapPanelSize(90, 200, 600, 120)).toEqual({ collapsed: true, size: 200 });
  });

  it('keeps the normal minimum before the snap threshold', () => {
    expect(snapPanelSize(150, 200, 600, 120)).toEqual({ collapsed: false, size: 200 });
  });

  it('passes through and caps regular sizes', () => {
    expect(snapPanelSize(360, 200, 600, 120)).toEqual({ collapsed: false, size: 360 });
    expect(snapPanelSize(900, 200, 600, 120)).toEqual({ collapsed: false, size: 600 });
  });
});
