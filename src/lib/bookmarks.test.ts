import { describe, expect, it } from 'vitest';

import { extractBookmarks, extractBookmarkTitles, hostOf } from './bookmarks';

describe('extractBookmarks', () => {
  it('現在の形式（リンク見出し）からタイトルとURLを取り出す', () => {
    const body = [
      '## [記事タイトル](https://example.com/a)',
      '',
      '要約の本文',
      '',
      '## [もう1件](https://example.org/b/)',
    ].join('\n');

    expect(extractBookmarks(body)).toEqual([
      { title: '記事タイトル', url: 'https://example.com/a', summary: '要約の本文' },
      { title: 'もう1件', url: 'https://example.org/b/' },
    ]);
  });

  it('旧形式（採番見出し）は直後の **URL:** 行からURLを補う', () => {
    const body = [
      '## 1. 昔の記事',
      '',
      '**URL:** [https://example.com/old](https://example.com/old)',
      '',
      '### AI要約',
      '',
      '要点：',
    ].join('\n');

    expect(extractBookmarks(body)).toEqual([
      { title: '昔の記事', url: 'https://example.com/old', summary: '要点：' },
    ]);
  });

  it('**URL:** 行が無い旧形式はURLなしのまま', () => {
    expect(extractBookmarks('## 1. 昔の記事')).toEqual([{ title: '昔の記事' }]);
  });

  it('次の見出しより後の **URL:** 行を前の記事に結び付けない', () => {
    const body = [
      '## 1. 記事A',
      '## 2. 記事B',
      '**URL:** [https://example.com/b](https://example.com/b)',
    ].join('\n');

    expect(extractBookmarks(body)).toEqual([
      { title: '記事A' },
      { title: '記事B', url: 'https://example.com/b' },
    ]);
  });

  it('要約は見出し直後の最初の地の文だけを取り、2行目以降は見ない', () => {
    const body = [
      '## [記事A](https://example.com/)',
      '',
      '1行目の要約',
      '2行目は無視する',
      '',
      '## [記事B](https://example.org/)',
    ].join('\n');

    expect(extractBookmarks(body)[0]!.summary).toBe('1行目の要約');
  });

  it('箇条書き・区切り線・見出し代わりの強調は要約にしない（旧形式）', () => {
    // 旧形式は `### AI要約` `**要点**` と箇条書きを挟んでから地の文が来る
    const body = [
      '## 1. 昔の記事',
      '',
      '**URL:** [https://example.com/old](https://example.com/old)',
      '',
      '### AI要約',
      '',
      '**要点**',
      '',
      '*   箇条書きの要点',
      '',
      '**詳細な要約**',
      '',
      '本文の書き出し。',
      '',
      '---',
    ].join('\n');

    expect(extractBookmarks(body)[0]!.summary).toBe('本文の書き出し。');
  });

  it('要約のリンクはテキストだけ残し、記法を落として1行にまとめる', () => {
    const body = [
      '## [記事A](https://example.com/)',
      '',
      '[**公式ブログ**](https://example.org/)  が  `useState` を解説。',
    ].join('\n');

    expect(extractBookmarks(body)[0]!.summary).toBe('公式ブログ が useState を解説。');
  });

  it('地の文が無ければ要約は付かない', () => {
    const body = ['## [記事A](https://example.com/)', '', '- 要点だけ'].join('\n');
    expect(extractBookmarks(body)[0]!.summary).toBeUndefined();
  });

  it('記事内のセクション見出しは拾わない', () => {
    const body = ['## 要点', '## 詳細な要約', '### [子見出し](https://example.com/)'].join(
      '\n'
    );
    expect(extractBookmarks(body)).toEqual([]);
  });

  it('強調記法とバッククォートを落として1行にまとめる', () => {
    const body = '## [**`useState`** を  読み解く](https://example.com/)';
    expect(extractBookmarkTitles(body)).toEqual(['useState を 読み解く']);
  });

  it('タイトルがURLのままの見出しはデコードして読める形にする', () => {
    // 元記事のタイトルが取れなかったブックマークは、はてなのRSSが返すURLが
    // そのままタイトルになる。パーセントエンコードのままだと日本語が読めない
    const body =
      '## 1. https://example.com/%E7%99%BB%E5%A3%87%E8%B3%87%E6%96%99.pdf';
    expect(extractBookmarkTitles(body)).toEqual(['https://example.com/登壇資料.pdf']);
  });

  it('URLに括弧が含まれていても最後まで取り出す', () => {
    const url = 'https://ja.wikipedia.org/wiki/%E5%9C%B0%E6%96%B9%E7%97%85_(%E6%97%A5%E6%9C%AC)';
    const body = ['## 1. 地方病', '', `**URL:** [地方病](${url})`].join('\n');
    expect(extractBookmarks(body)).toEqual([{ title: '地方病', url }]);
  });

  it('<> で囲まれた宛先からもURLを取り出す', () => {
    const url = 'https://example.com/a?ct=t(EMAIL';
    const body = ['## 1. キャンペーン', '', `**URL:** [リンク](<${url}>)`].join('\n');
    expect(extractBookmarks(body)).toEqual([{ title: 'キャンペーン', url }]);
  });

  it('見出しが無い本文では空になる', () => {
    expect(extractBookmarkTitles('ただの段落です。\n\n- 箇条書き')).toEqual([]);
  });
});

describe('hostOf', () => {
  it('www. を落として小文字で返す', () => {
    expect(hostOf('https://WWW.Example.com/path')).toBe('example.com');
  });

  it('サブドメインは残す', () => {
    expect(hostOf('https://blog.example.co.jp/entry/1')).toBe('blog.example.co.jp');
  });

  it('URLとして読めなければ undefined', () => {
    expect(hostOf('not a url')).toBeUndefined();
  });
});
