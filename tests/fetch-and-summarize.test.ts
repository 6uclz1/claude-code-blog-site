import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AbortRun,
  GeminiSummarizer,
  MAX_POINTS,
  POINT_MAX_CHARS,
  RSS_RETRY_COUNT,
  SUMMARY_FALLBACK,
  SUMMARY_MAX_CHARS,
  digest,
  fetchArticle,
  fetchArticleDirect,
  fetchArticleViaJina,
  fetchEntries,
  fetchPlan,
  generationConfig,
  parseArgs,
  parseDigest,
  postPath,
  renderPost,
  run,
  selectBookmarks,
  summarizeBookmarks,
  withResolvedTitle,
  writePost,
  yesterdayInJst,
  type ArticleFetchers,
  type ArticleOutcome,
  type Bookmark,
  type GenerativeClient,
  type SummarizedBookmark,
} from '../scripts/fetch-and-summarize.ts';
import { civilDate, postDateStamp } from '../scripts/lib/date.ts';
import type { FeedEntry } from '../scripts/lib/rss.ts';
import { bodyOf, createTempDir, frontMatterOf, okResponse } from './helpers.ts';

const noWait = async () => {};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('yesterdayInJst', () => {
  it('日本時間での前日を返す', () => {
    expect(yesterdayInJst(new Date('2025-06-22T10:00:00+09:00'))).toEqual(civilDate(2025, 6, 21));
  });

  it('UTCではまだ前日でも、JSTの日付基準で判定する', () => {
    expect(yesterdayInJst(new Date('2025-06-22T08:00:00+09:00'))).toEqual(civilDate(2025, 6, 21));
  });
});

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item rdf:about="https://b.hatena.ne.jp/u/20250621#bookmark-1">
    <title>A</title>
    <link>https://example.com/1</link>
    <dc:date>2025-06-21T08:42:35Z</dc:date>
  </item>
  <item rdf:about="https://b.hatena.ne.jp/u/20250621#bookmark-2">
    <title>B</title>
    <link>https://example.com/2</link>
    <dc:date>2025-06-21T09:42:35Z</dc:date>
  </item>
</rdf:RDF>`;

describe('fetchEntries', () => {
  it('RSSを取得してエントリに変換する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(RSS_XML, 'application/xml'));
    vi.stubGlobal('fetch', fetchMock);

    const entries = await fetchEntries('https://example.com/rss', { wait: noWait });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ title: 'A', link: 'https://example.com/1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.com/rss');
    // 取得先が応答しないとジョブがハングするため、必ずタイムアウトを付ける
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('繰り返し失敗したら空配列を返す', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchEntries('https://example.com/rss', { wait: noWait })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(RSS_RETRY_COUNT);
  });

  it('途中で成功したらそこで返す', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(okResponse(RSS_XML, 'application/xml'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchEntries('https://example.com/rss', { wait: noWait })).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('selectBookmarks', () => {
  const entry = (overrides: Partial<FeedEntry> = {}): FeedEntry => ({
    title: 'T',
    link: 'https://example.com/1',
    ...overrides,
  });

  it('dc:date とエントリIDのどちらでも対象日を拾う', () => {
    const result = selectBookmarks(
      [
        entry({
          title: 'Yesterday 1',
          link: 'https://example.com/1',
          dcDate: '2025-06-21T08:42:35Z',
          id: '/u/20250621#bookmark-1',
        }),
        entry({
          title: 'Today',
          link: 'https://example.com/2',
          dcDate: '2025-06-22T08:42:35Z',
          id: '/u/20250622#bookmark-2',
        }),
        entry({ title: 'Yesterday 2', link: 'https://example.com/3', id: '/u/20250621#bookmark-3' }),
      ],
      civilDate(2025, 6, 21)
    );

    expect(result.map((bookmark) => bookmark.title)).toEqual(['Yesterday 1', 'Yesterday 2']);
    expect(result[0]!.url).toBe('https://example.com/1');
  });

  it('published しか無いエントリも JST で判定する', () => {
    // UTC の 23:30 は JST では翌日
    const result = selectBookmarks(
      [entry({ title: 'Published only', published: '2025-06-20T23:30:00Z' })],
      civilDate(2025, 6, 21)
    );

    expect(result.map((bookmark) => bookmark.title)).toEqual(['Published only']);
  });

  it('日付もリンクも無いエントリは捨てる', () => {
    const result = selectBookmarks(
      [entry({ title: 'No date' }), entry({ title: 'No link', link: '', dcDate: '2025-06-21T08:42:35Z' })],
      civilDate(2025, 6, 21)
    );

    expect(result).toEqual([]);
  });

  it('同じURLは1件だけにする', () => {
    const result = selectBookmarks(
      [
        entry({ title: 'A', link: 'https://example.com/same', dcDate: '2025-06-21T01:00:00Z' }),
        entry({
          title: 'A (再ブクマ)',
          link: 'https://example.com/same',
          dcDate: '2025-06-21T02:00:00Z',
        }),
      ],
      civilDate(2025, 6, 21)
    );

    expect(result).toHaveLength(1);
  });
});

const longArticleHtml = (marker = 'main content') =>
  `<html><body><article><h1>Test Article</h1><p>This is the ${marker}.</p>` +
  `<p>${'本文のテキストです。'.repeat(40)}</p></article></body></html>`;

describe('fetchArticleDirect', () => {
  it('本文を抽出する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(longArticleHtml()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchArticleDirect('https://example.com/test');

    expect(result?.text).toContain('Test Article');
    expect(result?.text).toContain('main content');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ブラウザらしいヘッダを送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(longArticleHtml()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchArticleDirect('https://example.com/test');

    // Accept-Language が無いと日本語ページで英語版に振り分けられることがある
    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers['Accept-Language']).toContain('ja');
    expect(headers.Accept).toContain('text/html');
  });

  it('HTML以外（PDFなど）は本文として扱わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse('%PDF-1.7 binary...', 'application/pdf'))
    );

    expect(await fetchArticleDirect('https://example.com/slides.pdf')).toBeUndefined();
  });

  it('UTF-8 以外のページはヘッダの charset に従って読む', async () => {
    // Response.text() は常に UTF-8 として読むため、そのままだと文字化けする
    const html = '<html><body><article>日本語の本文</article></body></html>';
    const bytes = new Uint8Array(Buffer.from(html, 'utf16le'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse(bytes, 'text/html; charset=utf-16le'))
    );

    expect((await fetchArticleDirect('https://example.com/test'))?.text).toBe('日本語の本文');
  });

  it('取得に失敗したら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request failed')));

    expect(await fetchArticleDirect('https://example.com/test')).toBeUndefined();
  });

  it('本文が空なら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('<html><body></body></html>')));

    expect(await fetchArticleDirect('https://example.com/test')).toBeUndefined();
  });
});

describe('fetchArticleViaJina', () => {
  it('r.jina.ai を前置きしてテキストを返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('  ツイート本文\n\nです  ', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('JINA_API_KEY', '');

    const result = await fetchArticleViaJina('https://x.com/user/status/123');

    expect(result?.text).toBe('ツイート本文 です');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://r.jina.ai/https://x.com/user/status/123');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it('URLの # は別ページを取りに行かないようエスケープする', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('本文', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchArticleViaJina('https://example.com/a#section');

    expect(fetchMock.mock.calls[0]![0]).toBe('https://r.jina.ai/https://example.com/a%23section');
  });

  it('JINA_API_KEY があれば bearer トークンを送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('本文', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('JINA_API_KEY', 'secret-token');

    await fetchArticleViaJina('https://x.com/user/status/123');

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer secret-token');
  });

  it('空なら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('   ', 'text/plain')));

    expect(await fetchArticleViaJina('https://x.com/user/status/123')).toBeUndefined();
  });

  it('取得に失敗したら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request failed')));

    expect(await fetchArticleViaJina('https://x.com/user/status/123')).toBeUndefined();
  });
});

describe('fetchPlan', () => {
  const names = (url: string) => fetchPlan(url).map((step) => step.fetcher);

  it('通常のURLは直接取得してから r.jina.ai に落とす', () => {
    expect(names('https://example.com/a')).toEqual(['direct', 'jina']);
  });

  it('ポストは専用の取得経路を先に使う', () => {
    for (const url of [
      'https://x.com/user/status/1',
      'https://twitter.com/user/status/1',
      'https://mobile.twitter.com/user/status/1',
      'https://www.x.com/user/status/1',
      'https://x.com/i/web/status/1',
    ]) {
      expect(names(url), url).toEqual(['twitter', 'jina', 'direct']);
    }
  });

  it('ポストは短くても足切りしない', () => {
    expect(fetchPlan('https://x.com/user/status/1')[0]).toEqual({ fetcher: 'twitter', minChars: 1 });
  });

  it('プロフィールやトレンドは取得しない', () => {
    // 本文が無いので、取りに行っても「JavaScriptを有効に」しか返ってこない
    expect(names('https://x.com/peing_tech')).toEqual([]);
    expect(names('https://x.com/i/trending/2059406543393636372')).toEqual([]);
  });

  it('URLとして読めなければ取得しない', () => {
    expect(names('not a url')).toEqual([]);
  });
});

describe('fetchArticle', () => {
  const content = (text: string, source = 'stub') => ({ text, source });
  const fetchers = (
    overrides: Partial<Record<keyof ArticleFetchers, string | undefined>> = {}
  ): ArticleFetchers => ({
    twitter: vi.fn().mockResolvedValue(overrides.twitter ? content(overrides.twitter) : undefined),
    direct: vi.fn().mockResolvedValue(overrides.direct ? content(overrides.direct) : undefined),
    jina: vi.fn().mockResolvedValue(overrides.jina ? content(overrides.jina) : undefined),
  });
  const textOf = (outcome: ArticleOutcome) => (outcome.ok ? outcome.content.text : undefined);

  it('十分な長さが取れたら直接取得だけで済ませる', async () => {
    const stubs = fetchers({ direct: 'あ'.repeat(500) });

    expect(textOf(await fetchArticle('https://example.com/test', stubs))).toBe('あ'.repeat(500));
    expect(stubs.jina).not.toHaveBeenCalled();
  });

  it('直接取得に失敗したら r.jina.ai を使う', async () => {
    const stubs = fetchers({ jina: 'r.jina.ai の本文' });

    expect(textOf(await fetchArticle('https://example.com/test', stubs))).toBe('r.jina.ai の本文');
    expect(stubs.jina).toHaveBeenCalledWith('https://example.com/test');
  });

  it('直接取得が短すぎたら r.jina.ai を使う', async () => {
    const stubs = fetchers({ direct: '短い本文', jina: 'あ'.repeat(500) });

    expect(textOf(await fetchArticle('https://example.com/test', stubs))).toBe('あ'.repeat(500));
  });

  it('どこも規定の長さに届かなければ、いちばん長い本文を使う', async () => {
    const stubs = fetchers({ direct: '短い本文', jina: 'すこし長い本文' });

    expect(textOf(await fetchArticle('https://example.com/test', stubs))).toBe('すこし長い本文');
  });

  it('ログイン誘導やJavaScript案内は本文として採用しない', async () => {
    // 200 で返ってくるので、弾かないと「Xの利用にはJavaScriptが必要」と要約される
    const stubs = fetchers({
      direct: `JavaScript is not available. ${'x'.repeat(500)}`,
      jina: 'あ'.repeat(500),
    });

    expect(textOf(await fetchArticle('https://example.com/test', stubs))).toBe('あ'.repeat(500));
  });

  it('すべて定型文なら理由を添えて失敗にする', async () => {
    const stubs = fetchers({
      direct: 'Just a moment...',
      jina: 'Warning: Target URL returned error 404',
    });
    const outcome = await fetchArticle('https://example.com/test', stubs);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('r.jina.ai が取得に失敗');
  });

  it('ポストは専用経路を先に使い、短くても採用する', async () => {
    const stubs = fetchers({ twitter: '140字に満たないポスト本文' });

    expect(textOf(await fetchArticle('https://x.com/user/status/123', stubs))).toBe(
      '140字に満たないポスト本文'
    );
    expect(stubs.direct).not.toHaveBeenCalled();
    expect(stubs.jina).not.toHaveBeenCalled();
  });

  it('ポストが取れなければ r.jina.ai と直接取得に落とす', async () => {
    const stubs = fetchers({ jina: 'あ'.repeat(500) });

    expect(textOf(await fetchArticle('https://x.com/user/status/123', stubs))).toBe('あ'.repeat(500));
  });

  it('本文のないURLは取得そのものを行わない', async () => {
    const stubs = fetchers({ direct: 'あ'.repeat(500) });
    const outcome = await fetchArticle('https://x.com/i/trending/123', stubs);

    expect(outcome.ok).toBe(false);
    expect(stubs.twitter).not.toHaveBeenCalled();
    expect(stubs.direct).not.toHaveBeenCalled();
  });
});

describe('withResolvedTitle', () => {
  const url = 'https://x.com/user/status/123';

  it('はてなのタイトルがURLのままなら差し替える', () => {
    const resolved = withResolvedTitle(
      { title: url, url },
      { text: '本文', title: '@user のポスト: ほげ', source: 'twitter' }
    );

    expect(resolved.title).toBe('@user のポスト: ほげ');
  });

  it('タイトルがあるときは触らない', () => {
    const resolved = withResolvedTitle(
      { title: '記事のタイトル', url },
      { text: '本文', title: '@user のポスト: ほげ', source: 'twitter' }
    );

    expect(resolved.title).toBe('記事のタイトル');
  });
});

describe('parseDigest', () => {
  it('JSONを読む', () => {
    const result = parseDigest('{"summary": "要点を1行で。", "points": ["補足A", "補足B"]}');

    expect(result).toEqual(digest('要点を1行で。', ['補足A', '補足B']));
  });

  it('```json フェンス付きでも読む', () => {
    const result = parseDigest('```json\n{"summary": "フェンス付き。", "points": []}\n```');

    expect(result).toEqual(digest('フェンス付き。', []));
  });

  it('長すぎる要約と箇条書きを切り詰める', () => {
    const result = parseDigest(
      JSON.stringify({
        summary: 'あ'.repeat(SUMMARY_MAX_CHARS + 200),
        points: ['い'.repeat(POINT_MAX_CHARS + 50)],
      })
    );

    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(result.points[0]!.length).toBeLessThanOrEqual(POINT_MAX_CHARS);
  });

  it('切り詰めは句点を優先する', () => {
    const text = 'あ'.repeat(SUMMARY_MAX_CHARS - 20) + '。' + 'い'.repeat(50);
    const result = parseDigest(JSON.stringify({ summary: text, points: [] }));

    expect(result.summary.endsWith('。')).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
  });

  it('箇条書きの数に上限がある', () => {
    const points = Array.from({ length: MAX_POINTS + 3 }, (_, index) => `点${index}`);
    const result = parseDigest(JSON.stringify({ summary: 'まとめ。', points }));

    expect(result.points).toHaveLength(MAX_POINTS);
  });

  it('箇条書き記号と強調記法を落とす', () => {
    const result = parseDigest('{"summary": "まとめ。", "points": ["- **強調**された点"]}');

    expect(result.points).toEqual(['強調された点']);
  });

  it('JSONでなければ1行目を要約に使う', () => {
    const result = parseDigest('要点はこれです。\n\n続きの説明。');

    expect(result).toEqual(digest('要点はこれです。', []));
  });

  it('空の応答はフォールバック文言になる', () => {
    expect(parseDigest('').summary).toBe(SUMMARY_FALLBACK);
  });
});

describe('generationConfig', () => {
  it('JSONで返すよう指定している', () => {
    // 設定名が SDK の型に無くなれば npm run check（tsc）で落ちる
    expect(generationConfig()).toEqual({ responseMimeType: 'application/json', temperature: 0.2 });
  });
});

describe('GeminiSummarizer', () => {
  const bookmark: Bookmark = { title: 'Test Title', url: 'https://example.com/test' };
  type GenerateParams = Parameters<GenerativeClient['models']['generateContent']>[0];
  const clientWith = (impl: () => Promise<{ text?: string }>) => {
    const generateContent = vi.fn(async (_params: GenerateParams) => impl());
    return { client: { models: { generateContent } }, generateContent };
  };

  it('要約を返し、プロンプトにタイトルと本文を含める', async () => {
    const { client, generateContent } = clientWith(async () => ({
      text: '{"summary": "短い要約。", "points": ["点1"]}',
    }));

    const result = await new GeminiSummarizer('key', { client }).summarize(bookmark, '記事本文');

    expect(result).toEqual(digest('短い要約。', ['点1']));
    const params = generateContent.mock.calls[0]![0]!;
    expect(params.contents).toContain('Test Title');
    expect(params.contents).toContain('記事本文');
    expect(params.config.responseMimeType).toBe('application/json');
  });

  it('APIエラーはフォールバック文言にする', async () => {
    const { client } = clientWith(async () => {
      throw new Error('API Error');
    });

    const result = await new GeminiSummarizer('key', { client }).summarize(bookmark, '記事本文');

    expect(result).toEqual(digest(SUMMARY_FALLBACK, []));
  });

  it('応答が空でもフォールバック文言にする', async () => {
    const { client } = clientWith(async () => ({}));

    const result = await new GeminiSummarizer('key', { client }).summarize(bookmark, '記事本文');

    expect(result.summary).toBe(SUMMARY_FALLBACK);
  });
});

describe('postDateStamp', () => {
  it('UTC で見た日付がパーマリンクの日付と一致する', () => {
    for (const target of [civilDate(2025, 6, 21), civilDate(2026, 1, 1), civilDate(2026, 12, 31)]) {
      const stamp = postDateStamp(target);
      const instant = new Date(stamp.replace(' ', 'T').replace(' +0900', '+09:00'));
      expect(
        [instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate()],
        stamp
      ).toEqual([target.year, target.month, target.day]);
    }
  });
});

describe('renderPost', () => {
  const digests: SummarizedBookmark[] = [
    [{ title: 'Test Article 1', url: 'https://example.com/1' }, digest('1本目の要約。', ['点A', '点B'])],
    [{ title: 'Test Article 2', url: 'https://example.com/2' }, digest('2本目の要約。')],
  ];
  const target = civilDate(2025, 6, 21);

  it('front matter をブックマーク日から作る', () => {
    const front = frontMatterOf(renderPost(digests, target));

    expect(front.title).toBe('はてなブックマーク 2025年06月21日 の記事まとめ (2件)');
    // title / date / permalink はすべてブックマーク日から決める。
    // 実行時刻を使うと、実行した時間帯によってURLや表示日付が1日ずれる。
    expect(front.date).toBe('2025-06-21 09:00:00 +0900');
    expect(front.permalink).toBe('/2025/06/21/hatena-bookmarks/');
  });

  it('いつ実行しても同じ内容になる', () => {
    expect(frontMatterOf(renderPost(digests, target)).date).toBe(
      frontMatterOf(renderPost(digests, target)).date
    );
  });

  it('excerpt は1行', () => {
    const excerpt = String(frontMatterOf(renderPost(digests, target)).excerpt);

    expect(excerpt.trim()).not.toContain('\n');
    expect(excerpt).toContain('2件');
  });

  it('見出しをリンクにし、箇条書きを並べる', () => {
    const body = bodyOf(renderPost(digests, target));

    expect(body).toContain('## [Test Article 1](https://example.com/1)');
    expect(body).toContain('## [Test Article 2](https://example.com/2)');
    expect(body).toContain('1本目の要約。');
    expect(body).toContain('- 点A');
    expect(body).toContain('- 点B');
  });

  it('タイトルがURLのままなら日本語が読める形にする', () => {
    // 元記事のタイトルが取れなかったブックマークは、はてなのRSSが返す
    // パーセントエンコードされたURLがそのままタイトルになる
    const encoded: SummarizedBookmark[] = [
      [
        {
          title: 'https://example.com/%E7%99%BB%E5%A3%87%E8%B3%87%E6%96%99.pdf',
          url: 'https://example.com/%E7%99%BB%E5%A3%87%E8%B3%87%E6%96%99.pdf',
        },
        digest('資料の要約。'),
      ],
    ];

    expect(bodyOf(renderPost(encoded, target))).toContain(
      '## [https://example.com/登壇資料.pdf](https://example.com/%E7%99%BB%E5%A3%87%E8%B3%87%E6%96%99.pdf)'
    );
  });

  it('閉じない括弧を含むURLでもリンクが壊れない', () => {
    const tricky: SummarizedBookmark[] = [
      [{ title: 'キャンペーン', url: 'https://example.com/a?ct=t(EMAIL' }, digest('要約。')],
    ];

    expect(bodyOf(renderPost(tricky, target))).toContain(
      '## [キャンペーン](<https://example.com/a?ct=t(EMAIL>)'
    );
  });

  it('朝にパラッと読める分量に収まっている', () => {
    const body = bodyOf(renderPost(digests, target));

    expect(body.length).toBeLessThan(600);
    expect(body).not.toContain('### AI要約');
    expect(body).not.toContain('詳細な要約');
  });

  it('タイトルに " や \\ が入っても front matter が壊れない', () => {
    const tricky: SummarizedBookmark[] = [
      [
        { title: 'Skillsは"業務マニュアル付きの道具箱"', url: 'https://example.com/1' },
        digest('AIに "賭ける" 話。'),
      ],
      [
        { title: 'パス C:\\Users\\test と : コロン', url: 'https://example.com/2' },
        digest('バックスラッシュ \\ を含む要約。'),
      ],
    ];

    const markdown = renderPost(tricky, target);

    expect(String(frontMatterOf(markdown).title)).toContain('2025年06月21日');
    expect(bodyOf(markdown)).toContain('Skillsは"業務マニュアル付きの道具箱"');
  });

  it('本文中の波括弧はそのまま残る', () => {
    const markdown = renderPost(
      [
        [
          { title: 'GitHub Actionsの${{ }}記法', url: 'https://example.com' },
          digest('`${{ secrets.TOKEN }}` を直接展開しない。', ['{% if %} も同様']),
        ],
      ],
      target
    );
    const body = bodyOf(markdown);

    expect(body).toContain('${{ secrets.TOKEN }}');
    expect(body).toContain('{% if %}');
    expect(body).not.toContain('{% raw %}');
  });
});

describe('writePost', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> };
  let postsDir: string;
  const digests: SummarizedBookmark[] = [
    [{ title: 'Test Article', url: 'https://example.com' }, digest('要約。')],
  ];
  const target = civilDate(2025, 6, 21);

  beforeEach(async () => {
    tmp = await createTempDir();
    postsDir = path.join(tmp.dir, '_posts');
  });
  afterEach(() => tmp.cleanup());

  it('ファイルを作る', async () => {
    expect(await writePost(digests, target, postsDir)).toBe(true);
    expect(await readFile(postPath(target, postsDir), 'utf-8')).toContain('Test Article');
  });

  it('要約が無ければ作らない', async () => {
    expect(await writePost([], target, postsDir)).toBe(false);
  });

  it('既存ファイルは上書きしない', async () => {
    const filePath = postPath(target, postsDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'existing content', 'utf-8');

    expect(await writePost(digests, target, postsDir)).toBe(false);
    expect(await readFile(filePath, 'utf-8')).toBe('existing content');
  });
});

describe('summarizeBookmarks', () => {
  const found = (text: string, title?: string): ArticleOutcome => ({
    ok: true,
    content: title ? { text, title, source: 'stub' } : { text, source: 'stub' },
  });
  const missing = (reason: string): ArticleOutcome => ({ ok: false, reason });

  it('本文が取れないブックマークは飛ばし、理由を残す', async () => {
    const summarize = vi.fn().mockResolvedValue(digest('要約。'));
    const getArticle = vi
      .fn()
      .mockResolvedValueOnce(found('本文あり'))
      .mockResolvedValueOnce(missing('direct: 本文が取れない'));

    const result = await summarizeBookmarks(
      [
        { title: 'A', url: 'https://example.com/1' },
        { title: 'B', url: 'https://example.com/2' },
      ],
      { summarize },
      { intervalMs: 0, getArticle }
    );

    expect(result.digests.map(([bookmark]) => bookmark.title)).toEqual(['A']);
    expect(result.skipped).toEqual([
      { bookmark: { title: 'B', url: 'https://example.com/2' }, reason: 'direct: 本文が取れない' },
    ]);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('要約に失敗したブックマークは記事に載せない', async () => {
    // 「要約を生成できませんでした」だけの見出しは読む人にとって価値が無く、
    // フロントマターは正常なので公開前ゲートでも気づけない
    const summarize = vi.fn().mockResolvedValue(digest(SUMMARY_FALLBACK));
    const getArticle = vi.fn().mockResolvedValue(found('本文あり'));

    const result = await summarizeBookmarks([{ title: 'A', url: 'https://example.com/1' }], { summarize }, { intervalMs: 0, getArticle });

    expect(result.digests).toEqual([]);
    expect(result.skipped[0]!.reason).toBe('要約の生成に失敗');
  });

  it('取得経路がタイトルを持っていれば見出しに使う', async () => {
    const summarize = vi.fn().mockResolvedValue(digest('要約。'));
    const url = 'https://x.com/user/status/123';
    const getArticle = vi.fn().mockResolvedValue(found('ポスト本文', '@user のポスト: ほげ'));

    const result = await summarizeBookmarks([{ title: url, url }], { summarize }, { intervalMs: 0, getArticle });

    expect(result.digests[0]![0].title).toBe('@user のポスト: ほげ');
  });
});

describe('run', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> };
  let postsDir: string;
  const target = civilDate(2025, 6, 21);
  const bookmarkA: Bookmark = { title: 'A', url: 'https://example.com/1' };
  const entries: FeedEntry[] = [{ title: 'A', link: 'https://example.com/1' }];

  const deps = (overrides: Record<string, unknown> = {}) => ({
    fetchEntries: vi.fn().mockResolvedValue(entries),
    selectBookmarks: vi.fn().mockReturnValue([bookmarkA]),
    summarizeBookmarks: vi.fn().mockResolvedValue({
      digests: [[bookmarkA, digest('要約。')]] as SummarizedBookmark[],
      skipped: [],
    }),
    writePost: vi.fn().mockResolvedValue(true),
    createSummarizer: vi.fn().mockReturnValue({ summarize: vi.fn() }),
    ...overrides,
  });

  beforeEach(async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test_api_key');
    tmp = await createTempDir();
    // 実際の _posts を見に行くと、その日の記事があるだけで挙動が変わってしまう
    postsDir = path.join(tmp.dir, '_posts');
  });
  afterEach(() => tmp.cleanup());

  it('APIキーが無ければ中断する', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    await expect(run({ targetDate: target, postsDir, deps: deps() })).rejects.toThrow(AbortRun);
  });

  it('要約が全滅したら記事を書かずに中断する', async () => {
    const stubs = deps({
      summarizeBookmarks: vi.fn().mockResolvedValue({
        digests: [],
        skipped: [{ bookmark: bookmarkA, reason: '要約の生成に失敗' }],
      }),
    });

    await expect(run({ targetDate: target, postsDir, deps: stubs })).rejects.toThrow(AbortRun);
    expect(stubs.writePost).not.toHaveBeenCalled();
  });

  it('1件でも要約できていれば記事を作る', async () => {
    const ng: Bookmark = { title: 'B', url: 'https://example.com/2' };
    const stubs = deps({
      selectBookmarks: vi.fn().mockReturnValue([bookmarkA, ng]),
      summarizeBookmarks: vi.fn().mockResolvedValue({
        digests: [[bookmarkA, digest('要約。')]] as SummarizedBookmark[],
        skipped: [{ bookmark: ng, reason: '要約の生成に失敗' }],
      }),
    });

    expect(await run({ targetDate: target, postsDir, deps: stubs })).toBe(1);
    expect(stubs.writePost).toHaveBeenCalledTimes(1);
  });

  it('正常系では記事を1本作る', async () => {
    const stubs = deps();

    expect(await run({ targetDate: target, postsDir, deps: stubs })).toBe(1);
    expect(stubs.writePost).toHaveBeenCalledTimes(1);
  });

  it('RSSが空なら何もしない', async () => {
    const stubs = deps({ fetchEntries: vi.fn().mockResolvedValue([]) });

    expect(await run({ targetDate: target, postsDir, deps: stubs })).toBe(0);
  });

  it('対象日のブックマークが無ければ何もしない', async () => {
    const stubs = deps({ selectBookmarks: vi.fn().mockReturnValue([]) });

    expect(await run({ targetDate: target, postsDir, deps: stubs })).toBe(0);
  });

  it('本文取得が全滅したら中断する', async () => {
    const stubs = deps({
      selectBookmarks: vi
        .fn()
        .mockReturnValue([bookmarkA, { title: 'B', url: 'https://example.com/2' }]),
      summarizeBookmarks: vi.fn().mockResolvedValue({
        digests: [],
        skipped: [
          { bookmark: bookmarkA, reason: 'direct: 本文が取れない' },
          { bookmark: { title: 'B', url: 'https://example.com/2' }, reason: '本文のあるURLではない' },
        ],
      }),
    });

    await expect(run({ targetDate: target, postsDir, deps: stubs })).rejects.toThrow(AbortRun);
    expect(stubs.writePost).not.toHaveBeenCalled();
  });

  it('既に記事があるなら要約もしない', async () => {
    const filePath = postPath(target, postsDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'existing content', 'utf-8');
    const stubs = deps();

    expect(await run({ targetDate: target, postsDir, deps: stubs })).toBe(0);
    expect(stubs.summarizeBookmarks).not.toHaveBeenCalled();
    expect(await readFile(filePath, 'utf-8')).toBe('existing content');
  });

  it('--dry-run では書き込まない', async () => {
    const stubs = deps();
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    expect(await run({ targetDate: target, dryRun: true, postsDir, deps: stubs })).toBe(0);
    expect(stubs.writePost).not.toHaveBeenCalled();
    expect(String(write.mock.calls[0]![0])).toContain('## [A](https://example.com/1)');
  });
});

describe('parseArgs', () => {
  it('--date と --dry-run を読む', () => {
    expect(parseArgs(['--date', '2025-06-21', '--dry-run'])).toEqual({
      date: civilDate(2025, 6, 21),
      dryRun: true,
    });
    expect(parseArgs(['--date=2025-06-21']).date).toEqual(civilDate(2025, 6, 21));
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it('日付として読めない指定は中断させる', () => {
    expect(() => parseArgs(['--date', '2025/06/21'])).toThrow(AbortRun);
    expect(() => parseArgs(['--nope'])).toThrow(AbortRun);
  });
});
