export function methodShort(symbol: string): string {
  const i = symbol.lastIndexOf('.');
  return i === -1 ? symbol : symbol.slice(i + 1);
}
