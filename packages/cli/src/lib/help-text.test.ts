import { describe, expect, test } from 'vitest';
import { buildHelpText } from './help-text';

describe('buildHelpText', () => {
  test('includes examples', () => {
    const text = buildHelpText({ examples: ['easl publish file.md'] });
    expect(text).toContain('$ easl publish file.md');
  });

  test('includes context when provided', () => {
    const text = buildHelpText({
      context: 'Publishes content to easl.',
      examples: ['easl publish'],
    });
    expect(text).toContain('Publishes content to easl.');
  });

  test('includes global options', () => {
    const text = buildHelpText({ examples: ['easl list'] });
    expect(text).toContain('--json');
    expect(text).toContain('--quiet');
    expect(text).toContain('--api-url');
  });

  test('includes output section when provided', () => {
    const text = buildHelpText({
      output: '  {"url":"..."}',
      examples: ['easl publish'],
    });
    expect(text).toContain('Output (--json or piped):');
    expect(text).toContain('{"url":"..."}');
  });

  test('includes error codes when provided', () => {
    const text = buildHelpText({
      errorCodes: ['publish_error', 'file_error'],
      examples: ['easl publish'],
    });
    expect(text).toContain('Errors (exit code 1):');
    expect(text).toContain('publish_error | file_error');
  });

  test('renders multiple examples', () => {
    const text = buildHelpText({
      examples: ['easl publish file.md', 'easl publish --content "hi" --type markdown'],
    });
    expect(text).toContain('$ easl publish file.md');
    expect(text).toContain('$ easl publish --content "hi" --type markdown');
  });
});
