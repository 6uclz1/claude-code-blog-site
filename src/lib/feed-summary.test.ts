import { describe, expect, it } from 'vitest';

import type { BookmarkRef } from './bookmarks';
import {
  buildFeedSummaryBlocks,
  feedSummary,
  FEED_SUMMARY_MAX_CHARS,
  FEED_TITLE_MAX_CHARS,
} from './feed-summary';

const refs = (count: number, summary = '要約'): BookmarkRef[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `記事タイトル${i}`,
    url: `https://example.com/${i}`,
    summary: summary ? `${summary}${i}` : undefined,
  }));

const joined = (blocks: string[]) => blocks.join('\n\n');

describe('buildFeedSummaryBlocks', () => {
  it('タイトルに「・」を付け、要約とURLをぶら下げる', () => {
    expect(
      buildFeedSummaryBlocks([
        { title: 'A', url: 'https://example.com/a', summary: 'Aの要約' },
        { title: 'B', url: 'https://example.com/b', summary: 'Bの要約' },
      ])
    ).toEqual([
      '・A\n　Aの要約\n　https://example.com/a',
      '・B\n　Bの要約\n　https://example.com/b',
    ]);
  });

  it('要約やURLが無いブックマークはある行だけを出す', () => {
    expect(
      buildFeedSummaryBlocks([{ title: 'A' }, { title: 'B', summary: 'Bの要約' }])
    ).toEqual(['・A', '・B\n　Bの要約']);
  });

  it('長いタイトルは上限で省略する', () => {
    const title = 'あ'.repeat(FEED_TITLE_MAX_CHARS + 10);
    const [block] = buildFeedSummaryBlocks([{ title }]);
    expect(block!.slice(1)).toHaveLength(FEED_TITLE_MAX_CHARS);
    expect(block!.endsWith('…')).toBe(true);
  });

  it('日次記事の分量（10件・要約とURL付き）は全部そのまま載る', () => {
    const blocks = buildFeedSummaryBlocks(refs(10, '要約'.repeat(30)));
    expect(blocks).toHaveLength(10);
    expect(blocks.every((block) => block.split('\n').length === 3)).toBe(true);
    expect(joined(blocks).length).toBeLessThanOrEqual(FEED_SUMMARY_MAX_CHARS);
  });

  it('収まらなければまずURLを落とし、要約は残す', () => {
    const bookmarks = refs(3);
    const full = joined(buildFeedSummaryBlocks(bookmarks, 10_000)).length;
    const blocks = buildFeedSummaryBlocks(bookmarks, full - 1);

    expect(blocks).toEqual(['・記事タイトル0\n　要約0', '・記事タイトル1\n　要約1', '・記事タイトル2\n　要約2']);
  });

  it('URLを落としても収まらなければタイトルだけにして全件を残す', () => {
    const bookmarks = refs(3, '長い要約'.repeat(20));
    const blocks = buildFeedSummaryBlocks(bookmarks, 100);

    expect(blocks).toEqual(['・記事タイトル0', '・記事タイトル1', '・記事タイトル2']);
  });

  it('タイトルだけでも収まらない分は「ほかN件」に畳む', () => {
    const bookmarks = refs(200, '');
    const blocks = buildFeedSummaryBlocks(bookmarks);

    const tail = blocks.at(-1)!;
    expect(tail).toMatch(/^ほか\d+件$/);
    const folded = Number(tail.match(/\d+/)![0]);
    expect(folded + blocks.length - 1).toBe(bookmarks.length);
    expect(blocks.slice(0, -1).every((block) => !block.includes('\n'))).toBe(true);
    expect(joined(blocks).length).toBeLessThanOrEqual(FEED_SUMMARY_MAX_CHARS);
  });

  it('1件しかなければ上限を超えていても畳まずに出す（空の本文を避ける）', () => {
    expect(buildFeedSummaryBlocks([{ title: 'あ'.repeat(40) }], 10, 100)).toEqual([
      `・${'あ'.repeat(40)}`,
    ]);
  });

  it('空の入力では空を返す', () => {
    expect(buildFeedSummaryBlocks([])).toEqual([]);
  });
});

describe('feedSummary', () => {
  it('本文の見出しから要約付きの一覧を作り、件の間を空行で区切る', () => {
    const body = [
      '## [記事A](https://example.com/)',
      '',
      'Aの要約',
      '',
      '- 要点1',
      '',
      '## [記事B](https://example.org/)',
      '',
      'Bの要約',
    ].join('\n');

    expect(feedSummary(body, 'excerptは使われない')).toBe(
      '・記事A\n　Aの要約\n　https://example.com/\n\n・記事B\n　Bの要約\n　https://example.org/'
    );
  });

  it('見出しが無ければ excerpt を使う', () => {
    expect(feedSummary('本文だけ', ' 概要の  文章 ')).toBe('概要の 文章');
  });

  it('見出しも excerpt も無ければ undefined（summary を出さない）', () => {
    expect(feedSummary('本文だけ')).toBeUndefined();
    expect(feedSummary('本文だけ', '   ')).toBeUndefined();
  });
});
