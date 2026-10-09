/**
 * "What's new" items from an updater manifest's `notes` — the release's
 * CHANGELOG.md section (Keep a Changelog: `### Added` headings + `- ` bullets,
 * wrapped continuation lines). `- **Title**: desc` splits into title + desc;
 * a plain bullet is all title. Non-bullet text (e.g. a trailing link) is ignored.
 */
export type NoteItem = { kind: string; title: string; desc: string };

const plain = (s: string): string => s.replace(/\*\*|`/g, '').trim();

export function parseReleaseNotes(md: string): NoteItem[] {
  const raw: { kind: string; text: string }[] = [];
  let kind = '';
  for (const line of md.split(/\r?\n/)) {
    const heading = /^#{2,4}\s+(.+)/.exec(line);
    const bullet = /^[-*]\s+(.+)/.exec(line);
    if (heading) kind = heading[1].trim().toLowerCase();
    else if (bullet) raw.push({ kind, text: bullet[1].trim() });
    else if (/^\s+\S/.test(line) && raw.length) raw[raw.length - 1].text += ` ${line.trim()}`;
  }
  return raw.map(({ kind, text }) => {
    const bold = /^\*\*(.+?)\*\*[:.]?\s*[—–-]?\s*(.*)$/.exec(text);
    return bold ? { kind, title: plain(bold[1]), desc: plain(bold[2]) } : { kind, title: plain(text), desc: '' };
  });
}
