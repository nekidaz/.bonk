import { describe, it, expect } from 'vitest';
import {
  checkInput,
  countdown,
  guessInput,
  inputNamesOf,
  isSensitive,
  maskInput,
  newInput,
  normalizeInput,
  type InputDef,
} from './inputs';

const def = (patch: Partial<InputDef>): InputDef => ({ ...newInput('text'), ...patch });

describe('checkInput (mirrors domain/inputs.rs)', () => {
  it('a code needs exactly its cells', () => {
    const code = def({ type: 'code', length: 4 });
    expect(checkInput(code, '4829')).toBeNull();
    expect(checkInput(code, '482')).not.toBeNull();
    expect(checkInput(code, '48 9')).not.toBeNull();
    expect(checkInput(def({ type: 'code', length: 0 }), '482913')).toBeNull();
  });

  it('a number is checked against min, max and step counted from the min', () => {
    const n = def({ type: 'number', min: 100, max: 5_000_000, step: 100 });
    expect(normalizeInput(n, '25 000')).toBe('25000');
    expect(checkInput(n, '25000')).toBeNull();
    expect(checkInput(n, '50')).not.toBeNull();
    expect(checkInput(n, '5000100')).not.toBeNull();
    expect(checkInput(n, '150')).not.toBeNull();
    expect(checkInput(n, 'abc')).not.toBeNull();
  });

  it('text matches its whole pattern; empty obeys required', () => {
    const text = def({ pattern: '.+@.+\\..+' });
    expect(checkInput(text, 'ivan@dummy.pay')).toBeNull();
    expect(checkInput(text, 'ivan@dummypay')).not.toBeNull();
    expect(checkInput(text, '')).not.toBeNull();
    expect(checkInput(def({ required: false }), '')).toBeNull();
  });

  it('select, bool and json take only their values', () => {
    const select = def({ type: 'select', options: ['KZT', 'USD'] });
    expect(checkInput(select, 'USD')).toBeNull();
    expect(checkInput(select, 'EUR')).not.toBeNull();
    expect(checkInput(def({ type: 'bool' }), 'false')).toBeNull();
    expect(checkInput(def({ type: 'bool' }), 'yes')).not.toBeNull();
    expect(checkInput(def({ type: 'json' }), '[{"sku":"A"}]')).toBeNull();
    expect(checkInput(def({ type: 'json' }), '{oops')).not.toBeNull();
  });
});

describe('masking', () => {
  it('a code shows its tail, a secret nothing', () => {
    expect(maskInput(newInput('code'), '482913')).toBe('••••13');
    expect(maskInput(newInput('secret'), '482913')).toBe('••••');
    expect(maskInput(newInput('code'), '123')).toBe('••••');
    expect(isSensitive(newInput('code'))).toBe(true);
    expect(isSensitive(newInput('text'))).toBe(false);
  });
});

describe('inputNamesOf', () => {
  it('lists the asked variables a request uses, once each, in order', () => {
    const defs = { otp: newInput('code'), amount: newInput('number') };
    const node = {
      request: { url: '{{base}}/pay?a={{ amount }}', body: '{"code":"{{otp}}","again":"{{otp}}"}', headers: {} },
    };
    expect(inputNamesOf(node, defs)).toEqual(['amount', 'otp']);
    expect(inputNamesOf(node, {})).toEqual([]);
  });
});

describe('countdown', () => {
  it('counts down in m:ss and stops at zero', () => {
    expect(countdown(258_000)).toBe('4:18');
    expect(countdown(300_000)).toBe('5:00');
    expect(countdown(500)).toBe('0:01');
    expect(countdown(-4000)).toBe('0:00');
  });
});

describe('guessInput', () => {
  it('picks a type from the name', () => {
    expect(guessInput('otp').type).toBe('code');
    expect(guessInput('card_cvc').type).toBe('secret');
    expect(guessInput('amount').type).toBe('number');
    expect(guessInput('comment').type).toBe('text');
  });
});
