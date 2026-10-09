/**
 * Method / protocol accent colours for request badges.
 *
 * CSS variables keep the protocol hints muted and readable in both themes.
 * Colour stays semantic, but never competes with the request itself.
 */
/**
 * Short badge label for tree/history rows (Postman-style). Longest result is
 * 4 chars, so the badge column stays narrow and long methods never clip.
 */
export function methodLabel(method: string): string {
  switch (method.toUpperCase()) {
    case 'DELETE':
      return 'DEL';
    case 'OPTIONS':
      return 'OPT';
    case 'PATCH':
      return 'PAT';
    case 'QUERY':
      return 'QRY';
    default:
      return method.toUpperCase();
  }
}

export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'var(--method-get)';
    case 'POST':
      return 'var(--method-post)';
    case 'PUT':
    case 'OPTIONS':
      return 'var(--method-put)';
    case 'PATCH':
      return 'var(--method-patch)';
    case 'DELETE':
      return 'var(--method-delete)';
    case 'QUERY':
      return 'var(--method-query)';
    case 'GRPC':
      return 'var(--method-grpc)';
    default:
      return 'var(--t2)';
  }
}
