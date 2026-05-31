import { describe, expect, test } from 'vitest';
import { parseDurationToSeconds } from './duration';

describe('parseDurationToSeconds', () => {
  test('bare number is seconds', () => {
    expect(parseDurationToSeconds('3600')).toBe(3600);
  });

  test('seconds suffix', () => {
    expect(parseDurationToSeconds('90s')).toBe(90);
  });

  test('minutes', () => {
    expect(parseDurationToSeconds('30m')).toBe(1800);
  });

  test('hours', () => {
    expect(parseDurationToSeconds('12h')).toBe(43200);
  });

  test('days', () => {
    expect(parseDurationToSeconds('7d')).toBe(604800);
  });

  test('weeks', () => {
    expect(parseDurationToSeconds('2w')).toBe(1209600);
  });

  test('tolerates whitespace and case', () => {
    expect(parseDurationToSeconds('  7D ')).toBe(604800);
  });

  test('rejects garbage', () => {
    expect(() => parseDurationToSeconds('soon')).toThrow();
    expect(() => parseDurationToSeconds('7y')).toThrow();
    expect(() => parseDurationToSeconds('')).toThrow();
  });

  test('rejects zero and negative', () => {
    expect(() => parseDurationToSeconds('0')).toThrow();
    expect(() => parseDurationToSeconds('-5m')).toThrow();
  });
});
