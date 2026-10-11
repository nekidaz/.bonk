// DV3: the Timeline's «request as sent» — what bonk put on the wire, dynamic values marked.
import { toCurl, type DynamicValue, type Tab } from '$shared/model';

export interface Piece {
  text: string;
  /** This piece is a substituted `{{$dynamic}}` value. */
  dyn: boolean;
}

/** Split `text` around every occurrence of the dynamic values (longest first, so one can't eat another). */
export function markDynamic(text: string, values: DynamicValue[]): Piece[] {
  const wanted = [...new Set(values.map((v) => v.value).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!wanted.length) return text ? [{ text, dyn: false }] : [];
  const escaped = wanted.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text
    .split(new RegExp(`(${escaped.join('|')})`))
    .filter((part) => part !== '')
    .map((part) => ({ text: part, dyn: wanted.includes(part) }));
}

/** cURL of the request exactly as sent: already resolved, auth already in its headers. */
export function sentCurl(tab: Tab, request: Tab['request']): string {
  const bodyMode = request.bodyMode === 'graphql' ? 'raw' : request.bodyMode;
  return toCurl({ ...tab, params: undefined, request: { ...request, auth: undefined, bodyMode } });
}
