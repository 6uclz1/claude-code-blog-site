/**
 * feedparser の置き換え（scripts/lib/rss.ts）のテスト。
 *
 * はてなが返すのは RSS 1.0 だが、フィードの形式が変わっても記事が作られなくならないよう
 * RSS 2.0 / Atom も同じ形に正規化できることを確かめる。
 */

import { describe, expect, it } from 'vitest';

import { decodeNumericEntities, parseFeed } from '../scripts/lib/rss.ts';

describe('parseFeed', () => {
  it('RSS 1.0 (はてなの形式) を読む', () => {
    const entries = parseFeed(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://b.hatena.ne.jp/u/rss"><title>bookmarks</title></channel>
  <item rdf:about="https://b.hatena.ne.jp/u/20250621#bookmark-1">
    <title>記事A</title>
    <link>https://example.com/a</link>
    <dc:date>2025-06-21T08:42:35Z</dc:date>
  </item>
</rdf:RDF>`);

    expect(entries).toEqual([
      {
        title: '記事A',
        link: 'https://example.com/a',
        dcDate: '2025-06-21T08:42:35Z',
        id: 'https://b.hatena.ne.jp/u/20250621#bookmark-1',
        published: undefined,
      },
    ]);
  });

  it('RSS 2.0 を読む', () => {
    const entries = parseFeed(`<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>記事B</title>
    <link>https://example.com/b</link>
    <guid>https://b.hatena.ne.jp/u/20250621#bookmark-2</guid>
    <pubDate>Sat, 21 Jun 2025 08:42:35 +0000</pubDate>
  </item>
</channel></rss>`);

    expect(entries[0]).toMatchObject({
      title: '記事B',
      link: 'https://example.com/b',
      id: 'https://b.hatena.ne.jp/u/20250621#bookmark-2',
      published: 'Sat, 21 Jun 2025 08:42:35 +0000',
    });
  });

  it('Atom は link の href を使う', () => {
    const entries = parseFeed(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>記事C</title>
    <link href="https://example.com/c" rel="alternate" type="text/html"/>
    <link href="https://example.com/c/edit" rel="edit"/>
    <id>tag:example.com,2025:1</id>
    <published>2025-06-21T08:42:35Z</published>
  </entry>
</feed>`);

    expect(entries[0]).toMatchObject({
      title: '記事C',
      link: 'https://example.com/c',
      id: 'tag:example.com,2025:1',
      published: '2025-06-21T08:42:35Z',
    });
  });

  it('タイトルの文字参照を文字に戻す', () => {
    // はてなのRSSはタイトルの日本語を `&#x30B3;` のような文字参照で返すことがある。
    // 解かないまま記事にすると、フィードや /sites/ に文字参照の文字列が出る
    const entries = parseFeed(
      '<rss><channel><item>' +
        '<title>&#x30B3;&#x30FC;&#x30C9;&#x884C;&#x6570;&#12539;&#x3068;&#x306F;</title>' +
        '<link>https://example.com/a</link>' +
        '</item></channel></rss>'
    );

    expect(entries[0]?.title).toBe('コード行数・とは');
  });

  it('二重にエスケープされた文字参照も戻す', () => {
    const entries = parseFeed(
      '<rss><channel><item><title>&amp;#x30B3;&amp;#x30FC;&amp;#x30C9;</title>' +
        '<link>https://example.com/a</link></item></channel></rss>'
    );

    expect(entries[0]?.title).toBe('コード');
  });

  it('名前付き実体はXMLとして解いた結果のまま', () => {
    const entries = parseFeed(
      '<rss><channel><item><title>AT&amp;amp;T &amp;lt;Suspense&amp;gt;</title>' +
        '<link>https://example.com/a</link></item></channel></rss>'
    );

    // `&amp;` を解いた結果が `&` で止まること（`AT&T` をさらに壊さない）
    expect(entries[0]?.title).toBe('AT&amp;T &lt;Suspense&gt;');
  });

  it('item が1件でも配列で返す', () => {
    expect(parseFeed('<rss><channel><item><title>T</title></item></channel></rss>')).toHaveLength(1);
  });

  it('フィードでないXMLや壊れた入力は空配列', () => {
    expect(parseFeed('<html><body>not a feed</body></html>')).toEqual([]);
    expect(parseFeed('')).toEqual([]);
  });
});

describe('decodeNumericEntities', () => {
  it('10進・16進のどちらも戻す', () => {
    expect(decodeNumericEntities('&#x30B3;&#12467;')).toBe('ココ');
  });

  it('サロゲートペアが必要な文字も戻す', () => {
    expect(decodeNumericEntities('&#x1F600;')).toBe('\u{1F600}');
  });

  it('制御文字や範囲外の指定は元の表記のまま', () => {
    expect(decodeNumericEntities('a&#x0;b&#x110000;c')).toBe('a&#x0;b&#x110000;c');
  });

  it('名前付き実体には触らない', () => {
    expect(decodeNumericEntities('AT&amp;T &nbsp; &hellip;')).toBe('AT&amp;T &nbsp; &hellip;');
  });

  it('文字参照でない `&#` はそのまま', () => {
    expect(decodeNumericEntities('C&#プログラミング')).toBe('C&#プログラミング');
  });
});
