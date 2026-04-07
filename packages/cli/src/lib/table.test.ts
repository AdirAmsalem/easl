import { afterEach, describe, expect, test } from 'vitest';
import { renderTable } from './table';

describe('renderTable', () => {
  test('renders a table with border characters', () => {
    const output = renderTable(['Name', 'URL'], [['my-site', 'https://my-site.easl.dev']]);
    expect(output).toContain('Name');
    expect(output).toContain('my-site');
  });

  test('shows empty message when no rows', () => {
    expect(renderTable(['A'], [])).toBe('(no results)');
  });

  test('shows custom empty message', () => {
    expect(renderTable(['A'], [], 'Nothing here')).toBe('Nothing here');
  });

  test('pads columns to widest cell', () => {
    const output = renderTable(
      ['Key', 'Value'],
      [
        ['short', 'a very long value here'],
        ['much longer key', 'v'],
      ],
    );
    const lines = output.split('\n');
    const lengths = lines.map((l) => l.length);
    expect(new Set(lengths).size).toBe(1);
  });

  test('renders multiple rows', () => {
    const output = renderTable(
      ['Slug', 'URL'],
      [
        ['site-a', 'https://site-a.easl.dev'],
        ['site-b', 'https://site-b.easl.dev'],
      ],
    );
    expect(output).toContain('site-a');
    expect(output).toContain('site-b');
  });

  test('contains separator between header and data', () => {
    const output = renderTable(['Col'], [['val']]);
    // Should have some kind of separator (Unicode or ASCII)
    const lines = output.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4); // top + header + sep + data row + bottom
  });
});

describe('renderTable card layout fallback', () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  function setTerminalWidth(width: number | undefined) {
    Object.defineProperty(process.stdout, 'columns', {
      value: width,
      writable: true,
      configurable: true,
    });
  }

  test('renders table when terminal is wide enough', () => {
    setTerminalWidth(200);
    const output = renderTable(['Slug', 'URL'], [['test', 'https://test.easl.dev']]);
    // Should be in table format (contains vertical bars)
    expect(output.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  test('switches to cards when terminal is narrow', () => {
    setTerminalWidth(20);
    const output = renderTable(
      ['Slug', 'URL'],
      [['a-very-long-site-slug', 'https://a-very-long-site-slug.easl.dev']],
    );
    expect(output).toContain('a-very-long-site-slug');
    expect(output).toContain('https://a-very-long-site-slug.easl.dev');
  });

  test('cards separate multiple rows with blank lines', () => {
    setTerminalWidth(20);
    const output = renderTable(
      ['Slug', 'URL'],
      [
        ['site-a', 'https://site-a.easl.dev'],
        ['site-b', 'https://site-b.easl.dev'],
      ],
    );
    const cards = output.split('\n\n');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain('site-a');
    expect(cards[1]).toContain('site-b');
  });
});
