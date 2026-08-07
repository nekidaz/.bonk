/**
 * Method / protocol accent colours for request badges.
 *
 * CSS variables keep the protocol hints muted and readable in both themes.
 * Colour stays semantic, but never competes with the request itself.
 */
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'var(--method-get)';
    case 'POST':
      return 'var(--method-post)';
    case 'PUT':
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
