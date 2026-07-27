import { describe, expect, it } from 'vitest';

import {
  buildBookmarkLines,
  feedSummaryLines,
  FEED_SUMMARY_MAX_CHARS,
  FEED_SUMMARY_TITLE_MAX_CHARS,
} from './feed';

const lineLength = (lines: string[]) =>
  lines.reduce((total, line) => total + line.length + 1, 0);

describe('buildBookmarkLines', () => {
  it('各行に「・」を付ける', () => {
    expect(buildBookmarkLines(['A', 'B'])).toEqual(['・A', '・B']);
  });

  it('長いタイトルは上限で省略する', () => {
    const title = 'あ'.repeat(FEED_SUMMARY_TITLE_MAX_CHARS + 10);
    const [line] = buildBookmarkLines([title]);
    // 先頭の「・」を除いた本体が上限ちょうどで、末尾が省略記号になる
    expect(line!.slice(1)).toHaveLength(FEED_SUMMARY_TITLE_MAX_CHARS);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('上限を超える分は「ほかN件」に畳む', () => {
    const titles = Array.from({ length: 20 }, (_, i) => `記事タイトル${i}`.repeat(3));
    const lines = buildBookmarkLines(titles);

    const tail = lines.at(-1)!;
    expect(tail).toMatch(/^ほか\d+件$/);

    // 畳んだ件数と表示した件数の合計が元の件数と一致する
    const folded = Number(tail.match(/\d+/)![0]);
    expect(folded + (lines.length - 1)).toBe(titles.length);
    expect(lineLength(lines)).toBeLessThanOrEqual(FEED_SUMMARY_MAX_CHARS);
  });

  it('1件しかなければ上限を超えていても畳まずに出す（空の summary を避ける）', () => {
    const lines = buildBookmarkLines(['あ'.repeat(40)], 10, 100);
    expect(lines).toHaveLength(1);
  });

  it('全部収まるときは「ほかN件」を付けない', () => {
    const lines = buildBookmarkLines(['A', 'B', 'C']);
    expect(lines).toEqual(['・A', '・B', '・C']);
  });

  it('空の入力では空を返す', () => {
    expect(buildBookmarkLines([])).toEqual([]);
  });
});

describe('feedSummaryLines', () => {
  it('本文にブックマーク見出しがあれば一覧を使う', () => {
    const body = '## [記事A](https://example.com/)\n\n要約\n\n## [記事B](https://example.org/)';
    expect(feedSummaryLines(body, 'excerptは使われない')).toEqual([
      '・記事A',
      '・記事B',
    ]);
  });

  it('見出しが無ければ excerpt を1行として使う', () => {
    expect(feedSummaryLines('本文だけ', ' 概要の  文章 ')).toEqual(['概要の 文章']);
  });

  it('見出しも excerpt も無ければ空（summary要素を出さない）', () => {
    expect(feedSummaryLines('本文だけ')).toEqual([]);
    expect(feedSummaryLines('本文だけ', '   ')).toEqual([]);
  });
});
