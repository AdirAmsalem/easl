import {
  afterEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { errorMessage, outputError, outputResult } from './output';

describe('errorMessage', () => {
  test('extracts message from Error', () => {
    expect(errorMessage(new Error('fail'), 'default')).toBe('fail');
  });

  test('returns fallback for non-Error', () => {
    expect(errorMessage('string', 'default')).toBe('default');
    expect(errorMessage(null, 'default')).toBe('default');
    expect(errorMessage(42, 'default')).toBe('default');
  });
});

describe('outputResult', () => {
  let logSpy: MockInstance;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    logSpy?.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
  });

  test('outputs JSON when json option is true', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    outputResult({ id: '123' }, { json: true });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: '123' }, null, 2));
  });

  test('outputs JSON when stdout is not TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: undefined,
      writable: true,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    outputResult({ id: '123' });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: '123' }, null, 2));
  });

  test('outputs string directly', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    outputResult('Published successfully');
    expect(logSpy).toHaveBeenCalledWith('Published successfully');
  });

  test('outputs JSON for objects in human mode (fallback)', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    outputResult({ url: 'https://test.easl.dev' });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ url: 'https://test.easl.dev' }, null, 2),
    );
  });
});

describe('outputError', () => {
  let errorSpy: MockInstance;
  let logSpy: MockInstance;
  let exitSpy: MockInstance;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    errorSpy?.mockRestore();
    logSpy?.mockRestore();
    exitSpy?.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
  });

  test('outputs JSON error when json is true', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    outputError({ message: 'not found', code: 'not_found' }, { json: true });

    const expected = JSON.stringify(
      { error: { message: 'not found', code: 'not_found' } },
      null,
      2,
    );
    expect(logSpy).toHaveBeenCalledWith(expected);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('outputs colored text error when TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    outputError({ message: 'something broke' });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('something broke'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('uses custom exit code', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    outputError({ message: 'error' }, { exitCode: 2, json: true });
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  test('defaults code to "unknown"', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: undefined,
      writable: true,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    outputError({ message: 'oops' });

    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error.code).toBe('unknown');
  });
});
