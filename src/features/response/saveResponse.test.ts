import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));

import { responseFileName } from './saveResponse';

describe('responseFileName', () => {
  it('slugs the title and picks the extension by format', () => {
    expect(responseFileName('Create payment', 'JSON')).toBe('Create-payment-response.json');
    expect(responseFileName('  /// ', 'Text')).toBe('response-response.txt');
    expect(responseFileName('Список платежей', 'XML')).toBe('Список-платежей-response.xml');
  });
});
