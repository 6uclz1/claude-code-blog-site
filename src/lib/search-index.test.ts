import { describe, expect, it } from 'vitest';
import { buildSearchIndex, type SearchIndexInput } from './search-index';

const body = `## [記事タイトル](https://www.example.com/a)

その記事の1行要約。

- 要点1
- 要点2

## [別の記事](https://blog.example.jp/b)

もうひとつの要約。
`;

const input: SearchIndexInput = {
  site: { title: 'Bookmark Digest', description: 'はてなブックマークした記事の日次要約' },
  baseUrl: 'https://example.github.io/blog/',
  posts: [
    {
      title: '2026年07月31日 の記事まとめ',
      date: new Date('2026-07-31T00:00:00Z'),
      permalink: '/2026/07/31/hatena-bookmarks/',
      excerpt: '6件を1行ずつまとめました。',
      body,
    },
  ],
};

describe('buildSearchIndex', () => {
  it('記事のHTML版とMarkdown版のURLを両方持つ', () => {
    const post = buildSearchIndex(input).posts[0]!;
    expect(post.url).toBe(
      'https://example.github.io/blog/2026/07/31/hatena-bookmarks/'
    );
    expect(post.markdown).toBe(
      'https://example.github.io/blog/2026/07/31/hatena-bookmarks.md'
    );
    expect(post.date).toBe('2026-07-31');
    expect(post.excerpt).toBe('6件を1行ずつまとめました。');
  });

  it('ブックマークをタイトル・URL・ホスト・要約に分解する', () => {
    const { bookmarks } = buildSearchIndex(input).posts[0]!;
    expect(bookmarks).toEqual([
      {
        title: '記事タイトル',
        url: 'https://www.example.com/a',
        host: 'example.com',
        summary: 'その記事の1行要約。',
      },
      {
        title: '別の記事',
        url: 'https://blog.example.jp/b',
        host: 'blog.example.jp',
        summary: 'もうひとつの要約。',
      },
    ]);
  });

  it('URLも要約も無い見出し（旧形式）はタイトルだけになる', () => {
    const { bookmarks } = buildSearchIndex({
      ...input,
      posts: [{ ...input.posts[0]!, body: '## 1. 古い形式の見出し\n' }],
    }).posts[0]!;
    expect(bookmarks).toEqual([{ title: '古い形式の見出し' }]);
  });

  it('件数と入口のURLを載せる', () => {
    const index = buildSearchIndex(input);
    expect(index.postCount).toBe(1);
    expect(index.bookmarkCount).toBe(2);
    expect(index.site.searchUrlTemplate).toBe(
      'https://example.github.io/blog/search/?q={query}'
    );
    expect(index.site.llmsTxt).toBe('https://example.github.io/blog/llms.txt');
    expect(index.site.url).toBe(input.baseUrl);
  });

  it('長い excerpt は切り詰める', () => {
    const post = buildSearchIndex({
      ...input,
      posts: [{ ...input.posts[0]!, excerpt: 'あ'.repeat(400) }],
    }).posts[0]!;
    expect(post.excerpt?.endsWith('...')).toBe(true);
    expect(post.excerpt!.length).toBeLessThan(220);
  });

  it('記事が無くても壊れない', () => {
    const index = buildSearchIndex({ ...input, posts: [] });
    expect(index.posts).toEqual([]);
    expect(index.postCount).toBe(0);
    expect(index.bookmarkCount).toBe(0);
  });
});
