import { describe, expect, it } from 'vitest';

import type { BookmarkRef } from './bookmarks';
import {
  buildBookmarkLines,
  shareDescription,
  shareDescriptionLines,
  SHARE_DESCRIPTION_MAX_CHARS,
  SHARE_SUMMARY_MAX_CHARS,
  SHARE_TITLE_MAX_CHARS,
} from './share';

const lineLength = (lines: string[]) =>
  lines.reduce((total, line) => total + line.length + 1, 0);

const refs = (count: number, summary = '要約'): BookmarkRef[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `記事タイトル${i}`,
    url: `https://example.com/${i}`,
    summary: summary ? `${summary}${i}` : undefined,
  }));

describe('buildBookmarkLines', () => {
  it('タイトルに「・」を付け、要約をぶら下げる', () => {
    expect(
      buildBookmarkLines([
        { title: 'A', summary: 'Aの要約' },
        { title: 'B', summary: 'Bの要約' },
      ])
    ).toEqual(['・A', '　Aの要約', '・B', '　Bの要約']);
  });

  it('要約が無い記事はタイトルだけの行になる', () => {
    expect(buildBookmarkLines([{ title: 'A' }, { title: 'B', summary: '  ' }])).toEqual([
      '・A',
      '・B',
    ]);
  });

  it('長いタイトルは上限で省略する', () => {
    const title = 'あ'.repeat(SHARE_TITLE_MAX_CHARS + 10);
    const [line] = buildBookmarkLines([{ title }]);
    // 先頭の「・」を除いた本体が上限ちょうどで、末尾が省略記号になる
    expect(line!.slice(1)).toHaveLength(SHARE_TITLE_MAX_CHARS);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('長い要約は上限で省略する', () => {
    const summary = 'あ'.repeat(SHARE_SUMMARY_MAX_CHARS + 10);
    const [, line] = buildBookmarkLines([{ title: 'A', summary }]);
    expect(line!.slice(1)).toHaveLength(SHARE_SUMMARY_MAX_CHARS);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('日次記事の分量（10件・要約付き）は全部載る', () => {
    const bookmarks = refs(10, 'この記事の要点をひとことでまとめた行'.repeat(2));
    const lines = buildBookmarkLines(bookmarks);

    expect(lines.filter((line) => line.startsWith('・'))).toHaveLength(10);
    expect(lines.filter((line) => line.startsWith('　'))).toHaveLength(10);
    expect(lineLength(lines)).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX_CHARS);
  });

  it('要約付きが上限に収まらなければ、要約を落として全件のタイトルを残す', () => {
    const bookmarks = refs(20, 'あ'.repeat(SHARE_SUMMARY_MAX_CHARS));
    const lines = buildBookmarkLines(bookmarks);

    expect(lines).toHaveLength(20);
    expect(lines.every((line) => line.startsWith('・'))).toBe(true);
    expect(lineLength(lines)).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX_CHARS);
  });

  it('タイトルだけでも収まらない分は「ほかN件」に畳む', () => {
    const bookmarks = refs(80, '').map((ref) => ({
      ...ref,
      title: ref.title.repeat(3),
    }));
    const lines = buildBookmarkLines(bookmarks);

    const tail = lines.at(-1)!;
    expect(tail).toMatch(/^ほか\d+件$/);

    // 畳んだ件数と表示した件数の合計が元の件数と一致する
    const folded = Number(tail.match(/\d+/)![0]);
    expect(folded + (lines.length - 1)).toBe(bookmarks.length);
    expect(lineLength(lines)).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX_CHARS);
  });

  it('1件しかなければ上限を超えていても畳まずに出す（空の説明文を避ける）', () => {
    const lines = buildBookmarkLines([{ title: 'あ'.repeat(40) }], 10, 100);
    expect(lines).toHaveLength(1);
  });

  it('空の入力では空を返す', () => {
    expect(buildBookmarkLines([])).toEqual([]);
  });
});

describe('shareDescriptionLines', () => {
  it('本文の見出しと1行要約から一覧を作る', () => {
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

    expect(shareDescriptionLines(body, 'excerptは使われない')).toEqual([
      '・記事A',
      '　Aの要約',
      '・記事B',
      '　Bの要約',
    ]);
  });

  it('見出しが無ければ excerpt を1行として使う', () => {
    expect(shareDescriptionLines('本文だけ', ' 概要の  文章 ')).toEqual(['概要の 文章']);
  });

  it('見出しも excerpt も無ければ空', () => {
    expect(shareDescriptionLines('本文だけ')).toEqual([]);
    expect(shareDescriptionLines('本文だけ', '   ')).toEqual([]);
  });
});

describe('shareDescription', () => {
  it('Slack が改行として表示できるよう1行ずつ連結する', () => {
    const body = '## [記事A](https://example.com/)\n\nAの要約\n\n## [記事B](https://example.org/)';
    expect(shareDescription(body)).toBe('・記事A\n　Aの要約\n・記事B');
  });

  it('中身が無ければ undefined（既定の説明文に任せる）', () => {
    expect(shareDescription('本文だけ')).toBeUndefined();
  });
});
