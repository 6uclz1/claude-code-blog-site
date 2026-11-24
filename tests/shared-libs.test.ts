/**
 * 複数のスクリプトが共有する小さな部品のテスト
 * （scripts/lib の cli.ts / fs.ts / atom.ts と、rss.ts の日付候補の抽出）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AbortRun } from '../scripts/lib/abort.ts';
import { parseAtomFeed } from '../scripts/lib/atom.ts';
import { parseFlags, parseNumber } from '../scripts/lib/cli.ts';
import { civilDate } from '../scripts/lib/date.ts';
import { writeFileIfAbsent } from '../scripts/lib/fs.ts';
import { entryDatesJst } from '../scripts/lib/rss.ts';
import { createTempDir } from './helpers.ts';

describe('parseFlags', () => {
  const collect = (argv: string[]) => {
    const seen: Record<string, string | true> = {};
    parseFlags(argv, {
      '--name': (value) => {
        seen.name = value();
      },
      '--flag': () => {
        seen.flag = true;
      },
    });
    return seen;
  };

  it('`--flag value` と `--flag=value` の両方を読む', () => {
    expect(collect(['--name', 'a'])).toEqual({ name: 'a' });
    expect(collect(['--name=a=b'])).toEqual({ name: 'a=b' });
  });

  it('値を取らないフラグは次の引数を消費しない', () => {
    expect(() => collect(['--flag', 'extra'])).toThrow(/不明な引数: extra/);
  });

  it('値が無ければ例外', () => {
    expect(() => collect(['--name'])).toThrow(/--name には値が必要です/);
  });

  it('知らないフラグは例外。Object のプロトタイプにある名前も通さない', () => {
    expect(() => collect(['--nope'])).toThrow(/不明な引数/);
    expect(() => collect(['constructor'])).toThrow(/不明な引数/);
  });

  it('例外の種類を差し替えられる', () => {
    expect(() => parseFlags(['--nope'], {}, (message) => new AbortRun(message))).toThrow(
      AbortRun
    );
  });
});

describe('parseNumber', () => {
  it('数値として読めれば返す', () => {
    expect(parseNumber('--n', '36')).toBe(36);
    expect(parseNumber('--n', '1.5')).toBe(1.5);
  });

  it('数値でない・空文字は例外（Number("") は 0 になるので明示的に弾く）', () => {
    expect(() => parseNumber('--n', 'abc')).toThrow(/--n には数値が必要です/);
    expect(() => parseNumber('--n', '')).toThrow(/数値/);
  });
});

describe('writeFileIfAbsent', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await createTempDir());
  });
  afterEach(async () => {
    await cleanup();
  });

  it('無ければ親ディレクトリごと作って書く', async () => {
    const file = path.join(dir, 'nested', 'a.md');
    expect(await writeFileIfAbsent(file, 'new')).toBe(true);
    expect(await readFile(file, 'utf-8')).toBe('new');
  });

  it('既にあれば上書きせず false', async () => {
    const file = path.join(dir, 'a.md');
    await writeFile(file, 'existing', 'utf-8');
    expect(await writeFileIfAbsent(file, 'new')).toBe(false);
    expect(await readFile(file, 'utf-8')).toBe('existing');
  });
});

describe('entryDatesJst', () => {
  it('dc:date・published・エントリIDの日付をすべて候補にする（JST）', () => {
    const dates = entryDatesJst({
      title: 't',
      link: 'https://example.com/',
      // UTC 15:00 は JST の翌日 0:00
      dcDate: '2025-06-20T15:00:00Z',
      published: 'Fri, 20 Jun 2025 10:00:00 +0000',
      id: 'https://b.hatena.ne.jp/u/20250619#bookmark-1',
    });
    expect(dates).toEqual([civilDate(2025, 6, 21), civilDate(2025, 6, 20), civilDate(2025, 6, 19)]);
  });

  it('読めない日付は無視する', () => {
    expect(
      entryDatesJst({ title: 't', link: 'x', dcDate: 'not a date', id: 'https://x/20251399#b' })
    ).toEqual([]);
  });
});

describe('parseAtomFeed', () => {
  it('title / link / published / updated を取り出す', () => {
    const entries = parseAtomFeed(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">まとめ</title>
    <link href="https://example.com/2025/06/21/a/" rel="alternate"/>
    <published>2025-06-21T00:00:00+00:00</published>
    <updated>2025-06-22T00:00:00+00:00</updated>
  </entry>
  <entry><title>2026</title></entry>
</feed>`);
    expect(entries).toEqual([
      {
        title: 'まとめ',
        link: 'https://example.com/2025/06/21/a/',
        published: '2025-06-21T00:00:00+00:00',
        updated: '2025-06-22T00:00:00+00:00',
      },
      // 数値に見えるタイトルも文字列のまま
      { title: '2026', link: '', published: '', updated: '' },
    ]);
  });

  it('<feed> が無ければ undefined', () => {
    expect(parseAtomFeed('<rss><channel/></rss>')).toBeUndefined();
  });
});
