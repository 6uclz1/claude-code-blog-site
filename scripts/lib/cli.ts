/**
 * 自動化スクリプトのコマンドライン処理で共通する部分。
 *
 * どのスクリプトも `--flag value` と `--flag=value` の両方を受け付け、
 * テストから import されたときは main() を動かさない。同じ処理を各スクリプトに
 * 書き写していたので、ここに1つだけ置く。
 */

import { pathToFileURL } from 'node:url';

/**
 * フラグ1つ分の処理。値を取るフラグは `value()` を呼ぶ（呼ばなければ真偽値のフラグ）。
 * `value()` は `--flag=value` の値か、次の引数を返す。
 */
export type FlagHandler = (value: () => string) => void;

/** 引数の誤りをどの例外で返すか。AbortRun を使うスクリプトもある */
export type ErrorFactory = (message: string) => Error;

const plainError: ErrorFactory = (message) => new Error(message);

/** argv を先頭から読み、フラグごとの handler を呼ぶ。知らないフラグは例外 */
export function parseFlags(
  argv: string[],
  handlers: Record<string, FlagHandler>,
  makeError: ErrorFactory = plainError
): void {
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);

    const handler = Object.hasOwn(handlers, flag) ? handlers[flag] : undefined;
    if (!handler) throw makeError(`不明な引数: ${raw}`);

    handler(() => {
      const next = inline ?? argv[++index];
      if (next === undefined) throw makeError(`${flag} には値が必要です`);
      return next;
    });
  }
}

/** 数値として読めなければ例外 */
export function parseNumber(
  flag: string,
  raw: string,
  makeError: ErrorFactory = plainError
): number {
  const parsed = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(parsed)) throw makeError(`${flag} には数値が必要です`);
  return parsed;
}

/**
 * スクリプトとして実行されたときだけ main() を動かし、戻り値を終了コードにする。
 * テストからの import では何もしない。
 */
export function runIfMain(moduleUrl: string, main: () => Promise<number>): void {
  const entry = process.argv[1];
  if (!entry || moduleUrl !== pathToFileURL(entry).href) return;
  void main().then((code) => {
    process.exitCode = code;
  });
}
