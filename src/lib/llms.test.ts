import { describe, expect, it } from 'vitest';
import { renderLlmsTxt, type LlmsTxtInput } from './llms';

const input: LlmsTxtInput = {
  title: 'Bookmark Digest',
  description: 'はてなブックマークした記事の日次要約',
  urls: {
    home: 'https://example.github.io/blog/',
    search: 'https://example.github.io/blog/search/',
    archive: 'https://example.github.io/blog/archive/',
    sites: 'https://example.github.io/blog/sites/',
    feed: 'https://example.github.io/blog/feed.xml',
  },
  postCount: 333,
  recent: [
    {
      title: '2026年07月31日 の記事まとめ',
      url: 'https://example.github.io/blog/2026/07/31/hatena-bookmarks/',
      markdownUrl: 'https://example.github.io/blog/2026/07/31/hatena-bookmarks.md',
      date: new Date('2026-07-31T00:00:00Z'),
      excerpt: '6件を、1行ずつ\nまとめました。',
    },
  ],
};

describe('renderLlmsTxt', () => {
  it('llms.txt の形（H1 と引用の要約）で始まる', () => {
    const lines = renderLlmsTxt(input).split('\n');
    expect(lines[0]).toBe('# Bookmark Digest');
    expect(lines[2].startsWith('> ')).toBe(true);
    expect(lines[2]).toContain('333本');
  });

  it('検索と本文取得の入口を案内する', () => {
    const text = renderLlmsTxt(input);
    expect(text).toContain('https://example.github.io/blog/search/?q=');
    expect(text).toContain('.md');
    expect(text).toContain(input.urls.archive);
    expect(text).toContain(input.urls.feed);
  });

  it('記事は日付付きで Markdown 版へリンクする', () => {
    const text = renderLlmsTxt(input);
    expect(text).toContain(
      '- [2026-07-31 2026年07月31日 の記事まとめ](https://example.github.io/blog/2026/07/31/hatena-bookmarks.md): 6件を、1行ずつ まとめました。'
    );
  });

  it('長い excerpt は切り詰める（旧い記事は数百字ある）', () => {
    const line = renderLlmsTxt({
      ...input,
      recent: [{ ...input.recent[0], excerpt: 'あ'.repeat(400) }],
    })
      .split('\n')
      .find((text) => text.startsWith('- [2026-07-31'));
    expect(line).toContain('...');
    expect(line?.length).toBeLessThan(300);
  });

  it('記事が無くても壊れない', () => {
    const text = renderLlmsTxt({ ...input, postCount: 0, recent: [] });
    expect(text).toContain('# Bookmark Digest');
    expect(text).toContain(input.urls.home);
  });

  it('末尾は改行で終わる', () => {
    expect(renderLlmsTxt(input).endsWith('\n')).toBe(true);
  });
});
