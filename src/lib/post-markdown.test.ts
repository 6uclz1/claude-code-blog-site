import { describe, expect, it } from 'vitest';
import { postMarkdownPath, renderPostMarkdown } from './post-markdown';

const base = {
  title: 'はてなブックマーク 2026年07月31日 の記事まとめ (6件)',
  date: new Date('2026-07-31T00:00:00Z'),
  permalink: '/2026/07/31/hatena-bookmarks/',
  excerpt: '2026年07月31日にブックマークした6件を、1行ずつまとめました。',
  body: '## [記事](https://example.com/)\n\n要約。\n',
  url: 'https://example.github.io/blog/2026/07/31/hatena-bookmarks/',
};

describe('postMarkdownPath', () => {
  it('記事URLの末尾スラッシュを .md に替える', () => {
    expect(postMarkdownPath('/2026/07/31/hatena-bookmarks/')).toBe(
      '/2026/07/31/hatena-bookmarks.md'
    );
  });

  it('スラッシュの有無に関わらず同じパスになる', () => {
    expect(postMarkdownPath('2026/07/31/hatena-bookmarks')).toBe(
      '/2026/07/31/hatena-bookmarks.md'
    );
  });
});

describe('renderPostMarkdown', () => {
  it('front matter と本文を返す', () => {
    const text = renderPostMarkdown(base);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('permalink: /2026/07/31/hatena-bookmarks/');
    expect(text).toContain(`source: ${base.url}`);
    expect(text).toContain('date: \'2026-07-31T00:00:00.000Z\'');
    expect(text).toContain('## [記事](https://example.com/)');
  });

  it('本文の末尾は改行1つで終わる', () => {
    const text = renderPostMarkdown({ ...base, body: '本文\n\n\n' });
    expect(text.endsWith('本文\n')).toBe(true);
  });

  it('updated と excerpt は無ければ出さない', () => {
    const text = renderPostMarkdown({ ...base, excerpt: undefined });
    expect(text).not.toContain('excerpt:');
    expect(text).not.toContain('updated:');
  });

  it('updated があれば front matter に入る', () => {
    const text = renderPostMarkdown({
      ...base,
      updated: new Date('2026-08-01T10:00:00Z'),
    });
    expect(text).toContain('updated: \'2026-08-01T10:00:00.000Z\'');
  });

  it('タイトルの引用符で YAML が壊れない', () => {
    const text = renderPostMarkdown({ ...base, title: 'a: "b" \\ c' });
    // シリアライザを通しているので、そのまま貼られることはない
    expect(text).not.toContain('title: a: "b" \\ c');
    expect(text).toContain('title:');
  });
});
