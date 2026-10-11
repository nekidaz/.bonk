import { describe, expect, it } from 'vitest';
import type { GrpcStreamMessage } from '$shared/model';
import { intervalMs, matchesFilter, streamClock, streamCount, visibleMessages } from './streamFeed';

const msg = (index: number, atMs: number, body: string, sent = false): GrpcStreamMessage => ({
  index,
  atMs,
  body,
  sizeBytes: body.length,
  sent,
});

describe('matchesFilter', () => {
  const tick = '{"symbol":"USD","rate":486.21,"quote":{"bid":486.09}}';
  it('plain text matches anywhere, case-insensitive', () => {
    expect(matchesFilter(tick, 'usd')).toBe(true);
    expect(matchesFilter(tick, 'EUR')).toBe(false);
  });
  it('$.path alone keeps messages that have the field', () => {
    expect(matchesFilter(tick, '$.quote.bid')).toBe(true);
    expect(matchesFilter(tick, '$.quote.ask')).toBe(false);
  });
  it('compares numbers numerically and the rest as strings', () => {
    expect(matchesFilter(tick, '$.rate > 486')).toBe(true);
    expect(matchesFilter(tick, '$.rate <= 486')).toBe(false);
    expect(matchesFilter(tick, '$.symbol == "USD"')).toBe(true);
    expect(matchesFilter(tick, '$.symbol != USD')).toBe(false);
    expect(matchesFilter(tick, '$.symbol > 1')).toBe(false);
  });
  it('a non-JSON message never matches a path query', () => {
    expect(matchesFilter('oops', '$.a')).toBe(false);
  });
});

describe('feed', () => {
  const feed = [msg(1, 1000, '{"text":"hi"}', true), msg(1, 1120, '{"text":"hello"}'), msg(2, 1490, '{"rate":1}')];
  it('interval is from the previous message in either direction, the first from the start', () => {
    expect(intervalMs(feed, 0, 900)).toBe(100);
    expect(intervalMs(feed, 1, 900)).toBe(120);
    expect(intervalMs(feed, 2, 900)).toBe(370);
    expect(intervalMs(feed, 2, 900, 1400)).toBe(90); // the half-close counts as the previous event
    expect(intervalMs(feed, 1, 900, 1400)).toBe(120); // …only for what comes after it
  });
  it('filters by direction and text', () => {
    expect(visibleMessages(feed, 'sent', '')).toEqual([feed[0]]);
    expect(visibleMessages(feed, 'recv', 'hel')).toEqual([feed[1]]);
    expect(visibleMessages(feed, 'all', '')).toBe(feed);
  });
  it('counts by kind', () => {
    expect(streamCount('server', feed)).toBe('2');
    expect(streamCount('bidi', feed)).toBe('↑1 ↓2');
    expect(streamCount('client', [feed[0]])).toBe('↑1');
  });
  it('clock is local time, short drops the hour', () => {
    const at = new Date(2026, 9, 11, 14, 2, 17, 221).getTime();
    expect(streamClock(at)).toBe('14:02:17.221');
    expect(streamClock(at, true)).toBe('02:17.221');
  });
});
