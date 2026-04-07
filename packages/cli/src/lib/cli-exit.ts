export function setupCliExitHandler(): void {
  // Clear spinner line on SIGINT for clean exit
  process.on('SIGINT', () => {
    process.stderr.write('\r\x1B[2K');
    process.exit(130);
  });

  // Clean error output on uncaught exceptions
  process.on('uncaughtException', (err) => {
    process.stderr.write('\r\x1B[2K');
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
