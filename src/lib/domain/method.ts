/**
 * Method / protocol accent colours for request badges.
 *
 * These are deliberately theme-independent: the same saturated hues read on
 * both the light "paper" and dark "espresso" surfaces, mirroring the colour
 * language of the design (gRPC/RPC = blue, GET = green, etc.).
 */
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return '#10b981'; // green
    case 'POST':
      return '#f59e0b'; // amber
    case 'PUT':
      return '#3b82f6'; // blue
    case 'PATCH':
      return '#8b5cf6'; // purple
    case 'DELETE':
      return '#ef4444'; // red
    case 'GRPC':
      return '#3b82f6'; // blue (matches the RPC badge in the service tree)
    default:
      return '#3b82f6';
  }
}
