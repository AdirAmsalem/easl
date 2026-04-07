import pc from 'picocolors';
import { isInteractive, isUnicodeSupported } from './tty';
import { errorMessage, outputError, type OutputOptions } from './output';

const TICK = isUnicodeSupported ? String.fromCodePoint(0x2714) : 'v';
const WARN = isUnicodeSupported ? String.fromCodePoint(0x26a0) : '!';
const CROSS = isUnicodeSupported ? String.fromCodePoint(0x2717) : 'x';

const SPINNER_FRAMES = [
  '\u2839',
  '\u2838',
  '\u2834',
  '\u2826',
  '\u2807',
  '\u280F',
  '\u2819',
  '\u2839',
];
const SPINNER_INTERVAL = 80;

export function createSpinner(message: string, quiet?: boolean) {
  if (quiet || !isInteractive()) {
    return {
      update(_msg: string) {},
      stop(_msg?: string) {},
      clear() {},
      warn(_msg: string) {},
      fail(_msg: string) {},
    };
  }

  const frames = isUnicodeSupported ? SPINNER_FRAMES : ['-', '\\', '|', '/'];
  let i = 0;
  let text = message;

  const timer = setInterval(() => {
    process.stderr.write(`\r\x1B[2K  ${frames[i++ % frames.length]} ${text}`);
  }, SPINNER_INTERVAL);

  return {
    update(msg: string) {
      text = msg;
    },
    stop(msg?: string) {
      clearInterval(timer);
      if (msg) {
        process.stderr.write(`\r\x1B[2K  ${pc.green(TICK)} ${msg}\n`);
      } else {
        process.stderr.write('\r\x1B[2K');
      }
    },
    clear() {
      clearInterval(timer);
      process.stderr.write('\r\x1B[2K');
    },
    warn(msg: string) {
      clearInterval(timer);
      process.stderr.write(`\r\x1B[2K  ${pc.yellow(WARN)} ${msg}\n`);
    },
    fail(msg: string) {
      clearInterval(timer);
      process.stderr.write(`\r\x1B[2K  ${pc.red(CROSS)} ${msg}\n`);
    },
  };
}

export async function withSpinner<T>(
  loading: string,
  call: () => Promise<T>,
  errorCode: string,
  opts: OutputOptions,
): Promise<T> {
  const spinner = createSpinner(loading, opts.json);
  try {
    const result = await call();
    spinner.stop();
    return result;
  } catch (err) {
    spinner.fail(errorMessage(err, 'Unknown error'));
    return outputError(
      { message: errorMessage(err, 'Unknown error'), code: errorCode },
      opts,
    );
  }
}
