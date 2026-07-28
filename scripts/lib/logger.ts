/**
 * 自動化スクリプト用のログ出力。
 *
 * GitHub Actions のログをそのまま読むので、Python 版（logging.basicConfig）と
 * 同じ「時刻 - レベル - メッセージ」の形を保っている。
 */

type Level = 'INFO' | 'WARNING' | 'ERROR';

function timestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())},` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}

function emit(level: Level, message: string): void {
  const line = `${timestamp()} - ${level} - ${message}`;
  // 標準出力に混ざると --dry-run の出力をそのまま記事として使えないため、
  // ログは常に stderr へ出す
  process.stderr.write(`${line}\n`);
}

export const logger = {
  info: (message: string) => emit('INFO', message),
  warn: (message: string) => emit('WARNING', message),
  error: (message: string) => emit('ERROR', message),
};

/** 例外・非例外を問わず、ログに出せる1行の文字列にする */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
