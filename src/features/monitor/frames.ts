import { JANK_MS } from './series';
import type { FrameStats } from './store.svelte';

/** A frame longer than this also becomes a chart marker. */
const MARK_JANK_MS = 200;

/**
 * rAF loop for the Resources tab: once a second reports FPS, janks (frame gaps over JANK_MS),
 * the longest gap and the DOM size. WebKit has no `longtask` observer, so gaps are the signal.
 * Runs only while the tab is visible; returns the stop function.
 */
export function startFrames(onSecond: (f: FrameStats) => void, onJank: (at: number, ms: number) => void): () => void {
  let frames = 0;
  let janks = 0;
  let longest = 0;
  let last = performance.now();
  let windowStart = last;
  let id = requestAnimationFrame(function frame(now) {
    const gap = now - last;
    last = now;
    frames += 1;
    longest = Math.max(longest, gap);
    if (gap > JANK_MS) janks += 1;
    if (gap > MARK_JANK_MS) onJank(Date.now(), gap);
    if (now - windowStart >= 1000) {
      onSecond({
        fps: Math.round((frames * 1000) / (now - windowStart)),
        janks,
        longestMs: Math.round(longest),
        dom: document.getElementsByTagName('*').length,
      });
      frames = 0;
      janks = 0;
      longest = 0;
      windowStart = now;
    }
    id = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(id);
}
