import type { HttpResponse } from '$shared/model';

export type ResponseTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Colour role of a response status: 2xx/3xx success, 4xx warning, 5xx and network failures danger. */
export function responseTone(res: HttpResponse): ResponseTone {
  if (res.status === 0) return isCancelled(res) ? 'neutral' : 'danger';
  if (res.status >= 500) return 'danger';
  if (res.status >= 400) return 'warning';
  return 'success';
}

export function isCancelled(res: HttpResponse): boolean {
  return res.status === 0 && /cancel/i.test(res.body);
}

export function isTimeout(res: HttpResponse): boolean {
  return res.status === 0 && /timed? ?out|timeout|ETIMEDOUT/i.test(res.body);
}
