/**
 * vitest のカバレッジ結果を Markdown にする（プルリクにコメントするため）。
 *
 * `npm run test:coverage` が書き出す `coverage/coverage-summary.json` を読み、
 * 全体の数字とファイル別の内訳を1つの表にまとめる。CI はこの出力をそのまま
 * PR のコメントとジョブサマリに貼る。
 *
 * しきい値（--min-lines）を下回ったときは非ゼロで終了する。カバレッジは
 * 下がったことに気づけて初めて意味があるので、コメントを出すだけでは足りない。
 *
 * 使い方:
 *     npm run coverage-report -- --summary coverage/coverage-summary.json --min-lines 85
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describeError } from './lib/logger.ts';

/** PR コメントを毎回作り直さず上書きするための目印 */
export const COMMENT_MARKER = '<!-- coverage-report -->';

/** カバレッジが低いファイルだけ並べても意味がないので、全ファイルを出す上限 */
const MAX_FILE_ROWS = 40;

export interface Metric {
  total: number;
  covered: number;
  pct: number;
}

export interface FileCoverage {
  lines: Metric;
  statements: Metric;
  functions: Metric;
  branches: Metric;
}

export interface CoverageSummary {
  total: FileCoverage;
  files: { path: string; coverage: FileCoverage }[];
}

const METRIC_KEYS = ['lines', 'statements', 'functions', 'branches'] as const;

function asMetric(value: unknown): Metric | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const pct = record['pct'];
  const total = record['total'];
  const covered = record['covered'];
  if (typeof pct !== 'number' || typeof total !== 'number' || typeof covered !== 'number') {
    return undefined;
  }
  return { pct, total, covered };
}

function asFileCoverage(value: unknown): FileCoverage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const metrics = {} as Record<(typeof METRIC_KEYS)[number], Metric>;
  for (const key of METRIC_KEYS) {
    const metric = asMetric(record[key]);
    if (!metric) return undefined;
    metrics[key] = metric;
  }
  return metrics as FileCoverage;
}

/**
 * coverage-summary.json を読む。
 *
 * ファイルのキーは実行環境の絶対パスなので、リポジトリからの相対パスに直す
 * （CI のランナー上の `/home/runner/work/...` をそのまま貼っても読めない）。
 */
export function parseSummary(json: string, root: string = process.cwd()): CoverageSummary {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('coverage-summary.json の形式が不正です');
  }

  const record = parsed as Record<string, unknown>;
  const total = asFileCoverage(record['total']);
  if (!total) throw new Error('coverage-summary.json に total がありません');

  const files: CoverageSummary['files'] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === 'total') continue;
    const coverage = asFileCoverage(value);
    if (!coverage) continue;
    const relative = path.isAbsolute(key) ? path.relative(root, key) : key;
    files.push({ path: relative.split(path.sep).join('/'), coverage });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { total, files };
}

const format = (metric: Metric) => `${metric.pct.toFixed(2)}%`;

/** 一目で危ないファイルが分かるように、行カバレッジで色分けする */
export function statusIcon(pct: number): string {
  if (pct >= 90) return '🟢';
  if (pct >= 75) return '🟡';
  return '🔴';
}

function row(name: string, coverage: FileCoverage): string {
  const cells = METRIC_KEYS.map((key) => format(coverage[key]));
  return `| ${statusIcon(coverage.lines.pct)} ${name} | ${cells.join(' | ')} |`;
}

export interface RenderOptions {
  /** 下回ったら失敗にする行カバレッジ（%）。未指定ならしきい値なし */
  minLines?: number;
  /** コメントに実行ログへのリンクを載せる */
  runUrl?: string;
}

export function renderMarkdown(summary: CoverageSummary, options: RenderOptions = {}): string {
  const { total, files } = summary;
  const lines: string[] = [COMMENT_MARKER, '## 🧪 テストカバレッジ', ''];

  lines.push('| 対象 | Lines | Statements | Functions | Branches |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  lines.push(row('**全体**', total));
  lines.push('');

  if (options.minLines !== undefined) {
    const ok = total.lines.pct >= options.minLines;
    lines.push(
      ok
        ? `しきい値 ${options.minLines}% を満たしています（Lines ${format(total.lines)}）。`
        : `⚠️ しきい値 ${options.minLines}% を下回りました（Lines ${format(total.lines)}）。`
    );
    lines.push('');
  }

  if (files.length > 0) {
    // 数十行の表を常に開いておくとレビューの邪魔になるので折りたたむ。
    // 並びは「低い順」— 見るべきものが上に来る
    const sorted = [...files].sort((a, b) => a.coverage.lines.pct - b.coverage.lines.pct);
    const shown = sorted.slice(0, MAX_FILE_ROWS);

    lines.push('<details><summary>ファイル別（カバレッジの低い順）</summary>', '');
    lines.push('| ファイル | Lines | Statements | Functions | Branches |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const file of shown) lines.push(row(`\`${file.path}\``, file.coverage));
    if (sorted.length > shown.length) {
      lines.push('');
      lines.push(`ほか ${sorted.length - shown.length} ファイル`);
    }
    lines.push('', '</details>');
  }

  if (options.runUrl) {
    lines.push('', `[実行ログ](${options.runUrl}) · \`npm run test:coverage\` で手元でも確認できます`);
  }

  return `${lines.join('\n')}\n`;
}

interface CliArgs {
  summary: string;
  out?: string;
  minLines?: number;
  runUrl?: string;
  root: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { summary: 'coverage/coverage-summary.json', root: process.cwd() };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    const [flag, inline] = raw.includes('=')
      ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)]
      : [raw, undefined];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next === undefined) throw new Error(`${flag} には値が必要です`);
      return next;
    };

    switch (flag) {
      case '--summary':
        args.summary = value();
        break;
      case '--out':
        args.out = value();
        break;
      case '--min-lines': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed)) throw new Error('--min-lines には数値が必要です');
        args.minLines = parsed;
        break;
      }
      case '--run-url':
        args.runUrl = value();
        break;
      case '--root':
        args.root = value();
        break;
      default:
        throw new Error(`不明な引数: ${flag}`);
    }
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 2;
  }

  let summary: CoverageSummary;
  try {
    summary = parseSummary(await readFile(args.summary, 'utf-8'), args.root);
  } catch (error) {
    process.stderr.write(`カバレッジを読めませんでした: ${describeError(error)}\n`);
    return 2;
  }

  const markdown = renderMarkdown(summary, { minLines: args.minLines, runUrl: args.runUrl });
  if (args.out) await writeFile(args.out, markdown, 'utf-8');
  else process.stdout.write(markdown);

  if (args.minLines !== undefined && summary.total.lines.pct < args.minLines) {
    process.stderr.write(
      `❌ 行カバレッジ ${summary.total.lines.pct.toFixed(2)}% が ` +
        `しきい値 ${args.minLines}% を下回りました\n`
    );
    return 1;
  }
  return 0;
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
