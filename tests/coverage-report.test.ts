/** カバレッジのMarkdown化(scripts/coverage-report.ts)のテスト */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMENT_MARKER,
  main,
  parseArgs,
  parseSummary,
  renderMarkdown,
  statusIcon,
  type FileCoverage,
} from '../scripts/coverage-report.ts';
import { createTempDir } from './helpers.ts';

const metric = (pct: number) => ({ total: 100, covered: Math.round(pct), pct });

const coverage = (pct: number): FileCoverage => ({
  lines: metric(pct),
  statements: metric(pct),
  functions: metric(pct),
  branches: metric(pct),
});

const summaryJson = (files: Record<string, number>, totalPct: number) =>
  JSON.stringify({
    total: coverage(totalPct),
    ...Object.fromEntries(Object.entries(files).map(([file, pct]) => [file, coverage(pct)])),
  });

let tmp: { dir: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  tmp = await createTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
  vi.restoreAllMocks();
});

describe('parseSummary', () => {
  it('全体とファイル別の数字を取り出す', () => {
    const parsed = parseSummary(summaryJson({ '/repo/scripts/a.ts': 50 }, 88.82), '/repo');

    expect(parsed.total.lines.pct).toBe(88.82);
    expect(parsed.files).toEqual([{ path: 'scripts/a.ts', coverage: coverage(50) }]);
  });

  it('絶対パスをリポジトリからの相対パスに直す', () => {
    const parsed = parseSummary(summaryJson({ '/home/runner/work/blog/src/lib/x.ts': 90 }, 90), '/home/runner/work/blog');

    expect(parsed.files[0]!.path).toBe('src/lib/x.ts');
  });

  it('相対パスのキーはそのまま使う', () => {
    const parsed = parseSummary(summaryJson({ 'src/lib/x.ts': 90 }, 90), '/repo');

    expect(parsed.files[0]!.path).toBe('src/lib/x.ts');
  });

  it('total がなければ例外', () => {
    expect(() => parseSummary('{"src/a.ts": {}}')).toThrow(/total/);
  });

  it('JSONでなければ例外', () => {
    expect(() => parseSummary('not json')).toThrow();
  });

  it('形の合わないファイルの項目は無視する', () => {
    const json = JSON.stringify({ total: coverage(90), 'src/a.ts': { lines: 'broken' } });

    expect(parseSummary(json).files).toEqual([]);
  });
});

describe('statusIcon', () => {
  it('カバレッジで色を変える', () => {
    expect(statusIcon(95)).toBe('🟢');
    expect(statusIcon(80)).toBe('🟡');
    expect(statusIcon(10)).toBe('🔴');
  });
});

describe('renderMarkdown', () => {
  const summary = parseSummary(
    summaryJson({ 'src/lib/high.ts': 100, 'scripts/low.ts': 20 }, 88.82),
    process.cwd()
  );

  it('コメントを上書きするための目印を先頭に置く', () => {
    expect(renderMarkdown(summary).startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('全体の数字を表に出す', () => {
    expect(renderMarkdown(summary)).toContain('88.82%');
  });

  it('ファイル別はカバレッジの低い順に並べる', () => {
    const markdown = renderMarkdown(summary);

    expect(markdown.indexOf('scripts/low.ts')).toBeLessThan(markdown.indexOf('src/lib/high.ts'));
  });

  it('しきい値を下回ったら警告を出す', () => {
    expect(renderMarkdown(summary, { minLines: 95 })).toContain('⚠️');
  });

  it('しきい値を満たしていれば警告を出さない', () => {
    expect(renderMarkdown(summary, { minLines: 80 })).not.toContain('⚠️');
  });

  it('しきい値がなければ言及しない', () => {
    expect(renderMarkdown(summary)).not.toContain('しきい値');
  });

  it('実行ログへのリンクを載せる', () => {
    expect(renderMarkdown(summary, { runUrl: 'https://example.com/run/1' })).toContain(
      'https://example.com/run/1'
    );
  });
});

describe('parseArgs', () => {
  it('既定値を持つ', () => {
    expect(parseArgs([]).summary).toBe('coverage/coverage-summary.json');
  });

  it('--flag=value 形式も読む', () => {
    expect(parseArgs(['--min-lines=85']).minLines).toBe(85);
  });

  it('数値でないしきい値は例外', () => {
    expect(() => parseArgs(['--min-lines', 'abc'])).toThrow(/数値/);
  });

  it('知らない引数は例外', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/不明な引数/);
  });
});

describe('main', () => {
  const write = async (name: string, content: string) => {
    const filePath = path.join(tmp.dir, name);
    await writeFile(filePath, content, 'utf-8');
    return filePath;
  };

  it('しきい値を満たしていれば 0 を返す', async () => {
    const summary = await write('summary.json', summaryJson({ 'src/a.ts': 90 }, 90));
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    expect(await main(['--summary', summary, '--min-lines', '85'])).toBe(0);
  });

  it('しきい値を下回ったら 1 を返す', async () => {
    const summary = await write('summary.json', summaryJson({ 'src/a.ts': 10 }, 10));
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(await main(['--summary', summary, '--min-lines', '85'])).toBe(1);
  });

  it('--out に書き出す', async () => {
    const summary = await write('summary.json', summaryJson({ 'src/a.ts': 90 }, 90));
    const out = path.join(tmp.dir, 'comment.md');

    expect(await main(['--summary', summary, '--out', out])).toBe(0);
    expect(await readFile(out, 'utf-8')).toContain(COMMENT_MARKER);
  });

  it('カバレッジのファイルがなければ 2 を返す', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(await main(['--summary', path.join(tmp.dir, 'missing.json')])).toBe(2);
  });

  it('引数が不正なら 2 を返す', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(await main(['--nope'])).toBe(2);
  });
});
