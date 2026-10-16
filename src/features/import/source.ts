// Reading an import source (IM2/IM6): sniff the format from the content, not the extension,
// parse it once, and turn a broken document into an error with a line and a column.
import { parse as parseYaml, YAMLParseError } from 'yaml';
import {
  isOpenApiDoc,
  parseCurlFile,
  parseInsomniaExport,
  parsePostmanCollection,
  readOpenApi,
  type ParsedPostmanCollection,
  type ParsedSpec,
} from '$entities/workspace';
import { t, tp } from '$shared/i18n';
import { readHar, type HarLog } from './har';

/** Where the text came from. `location` is the URL or file path ('' for a paste). */
export interface Origin {
  kind: 'file' | 'url' | 'paste';
  location: string;
  name: string;
  size: number;
}

type Doc = Record<string, unknown>;

interface Common {
  origin: Origin;
  title: string;
  /** `OpenAPI 3.1`, `Postman v2.1`, `HAR`, `cURL`… */
  label: string;
  /** `info.version` of an API spec, '' otherwise. */
  version: string;
  syntax: 'JSON' | 'YAML' | 'text';
}

/** A parsed source. OpenAPI keeps the document: the preview re-reads it when an option changes. */
export type Loaded = Common &
  (
    | { format: 'openapi'; doc: Doc; spec: ParsedSpec }
    | { format: 'postman' | 'insomnia' | 'curl'; collection: ParsedPostmanCollection }
    | { format: 'har'; har: HarLog }
  );

/** A source that doesn't read. `line`/`col` are 1-based, set for a syntax error. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly col?: number,
    readonly syntax?: 'JSON' | 'YAML',
    /** What the text looks like (`OpenAPI 3.1`), for «Похоже на …». */
    readonly guess?: string,
  ) {
    super(message);
  }
}

const isObject = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a document that doesn't parse probably is, from a few telltale keys. */
export function guessFormat(text: string): string {
  const oas = /["']?openapi["']?\s*:\s*["']?(3\.\d)/.exec(text);
  if (oas) return `OpenAPI ${oas[1]}`;
  if (/["']?swagger["']?\s*:\s*["']?2\.0/.test(text)) return 'Swagger 2.0';
  if (/schema\.getpostman\.com/.test(text)) return 'Postman';
  if (/__export_format/.test(text)) return 'Insomnia';
  if (/"log"\s*:\s*\{/.test(text)) return 'HAR';
  return '';
}

/** Known `yaml` error codes in plain words; anything else keeps the library's message. */
const YAML_CODES: Record<string, string> = {
  BAD_INDENT: 'import.yaml.indent',
  MISSING_CHAR: 'import.yaml.missing',
  MULTILINE_IMPLICIT_KEY: 'import.yaml.key',
  BLOCK_AS_IMPLICIT_KEY: 'import.yaml.key',
  DUPLICATE_KEY: 'import.yaml.duplicate',
  TAB_AS_INDENT: 'import.yaml.tab',
  UNEXPECTED_TOKEN: 'import.yaml.token',
};

/** JSON first, then YAML; a failure carries the position the YAML parser stopped at. */
function parseDoc(text: string): { doc: unknown; syntax: 'JSON' | 'YAML' } {
  try {
    return { doc: JSON.parse(text), syntax: 'JSON' };
  } catch {
    /* not JSON: YAML below (a superset, so it also locates JSON errors) */
  }
  const syntax = /^\s*[[{]/.test(text) ? 'JSON' : 'YAML';
  try {
    return { doc: parseYaml(text), syntax };
  } catch (e) {
    if (!(e instanceof YAMLParseError))
      throw new SourceError(String(e), undefined, undefined, syntax, guessFormat(text));
    const pos = e.linePos?.[0];
    const key = YAML_CODES[e.code];
    const reason = key ? t(key) : e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
    throw new SourceError(reason, pos?.line, pos?.col, syntax, guessFormat(text));
  }
}

/** Parse `text` into a source the preview can show; throws SourceError. */
export function loadSource(text: string, origin: Origin): Loaded {
  if (/^\s*curl\s/i.test(text)) {
    const collection = parseCurlFile(text);
    return { origin, title: collection.title, label: 'cURL', version: '', syntax: 'text', format: 'curl', collection };
  }
  const { doc, syntax } = parseDoc(text);
  if (!isObject(doc)) throw new SourceError(t('import.err.unknown'));
  const common = { origin, syntax, version: '' };
  try {
    if (isOpenApiDoc(doc)) {
      const spec = readOpenApi(doc, origin.name);
      return { ...common, title: spec.title, label: spec.format, version: spec.version, format: 'openapi', doc, spec };
    }
    if (isObject(doc.info) && Array.isArray(doc.item)) {
      const collection = parsePostmanCollection(text);
      const v = /collection\/v(\d+\.\d+)/.exec(String(doc.info.schema ?? ''))?.[1];
      return { ...common, title: collection.title, label: `Postman v${v ?? '2.1'}`, format: 'postman', collection };
    }
    if (doc._type === 'export' && Array.isArray(doc.resources)) {
      const collection = parseInsomniaExport(text);
      const label = `Insomnia v${String(doc.__export_format ?? 4)}`;
      return { ...common, title: collection.title, label, format: 'insomnia', collection };
    }
    if (isObject(doc.log) && Array.isArray(doc.log.entries)) {
      const har = readHar(doc.log, origin.name);
      return { ...common, title: har.title, label: 'HAR', format: 'har', har };
    }
  } catch (e) {
    throw e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
  }
  throw new SourceError(t('import.err.unknown'));
}

/** Size as on the card: `214 KB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Counted request items of a collection tree. */
function countRequests(items: ParsedPostmanCollection['items']): number {
  return items.reduce((n, i) => n + (i.kind === 'folder' ? countRequests(i.items) : 1), 0);
}

/** The detected-source card's stats line: `38 operations · 6 tags · 2 servers · bearerAuth · 41 schemas`. */
export function sourceStats(s: Loaded): string[] {
  if (s.format === 'openapi') {
    const { spec } = s;
    return [
      `${spec.ops.length} ${tp(spec.ops.length, ['operation', 'operations'])}`,
      `${spec.tags} ${tp(spec.tags, ['tag', 'tags'])}`,
      `${spec.servers.length} ${tp(spec.servers.length, ['server', 'servers'])}`,
      ...spec.schemeNames.slice(0, 2),
      `${spec.schemas} ${tp(spec.schemas, ['schema', 'schemas'])}`,
    ];
  }
  if (s.format === 'har') {
    const n = s.har.entries.length;
    const hosts = new Set(s.har.entries.map((e) => e.host)).size;
    return [`${n} ${tp(n, ['entry', 'entries'])}`, `${hosts} ${tp(hosts, ['domain', 'domains'])}`];
  }
  const n = countRequests(s.collection.items);
  const folders = s.collection.items.filter((i) => i.kind === 'folder').length;
  const vars = s.collection.variables.length;
  return [
    `${n} ${tp(n, ['request', 'requests'])}`,
    ...(folders ? [`${folders} ${tp(folders, ['folder', 'folders'])}`] : []),
    ...(vars ? [`${vars} ${tp(vars, ['variable', 'variables'])}`] : []),
  ];
}
