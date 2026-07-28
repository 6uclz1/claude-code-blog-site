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
  fetchArticleText,
  fetchArticleTextDirect,
  fetchArticleTextViaJina,
  fetchEntries,
  generationConfig,
  parseArgs,
  parseDigest,
  postPath,
  prefersJina,
  renderPost,
  run,
  selectBookmarks,
  summarizeBookmarks,
  writePost,
  yesterdayInJst,
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

describe('fetchArticleTextDirect', () => {
  it('本文を抽出する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(longArticleHtml()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchArticleTextDirect('https://example.com/test');

    expect(result).toContain('Test Article');
    expect(result).toContain('main content');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('UTF-8 以外のページはヘッダの charset に従って読む', async () => {
    // Response.text() は常に UTF-8 として読むため、そのままだと文字化けする
    const html = '<html><body><article>日本語の本文</article></body></html>';
    const bytes = new Uint8Array(Buffer.from(html, 'utf16le'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse(bytes, 'text/html; charset=utf-16le'))
    );

    expect(await fetchArticleTextDirect('https://example.com/test')).toBe('日本語の本文');
  });

  it('取得に失敗したら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request failed')));

    expect(await fetchArticleTextDirect('https://example.com/test')).toBeUndefined();
  });

  it('本文が空なら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('<html><body></body></html>')));

    expect(await fetchArticleTextDirect('https://example.com/test')).toBeUndefined();
  });
});

describe('fetchArticleTextViaJina', () => {
  it('r.jina.ai を前置きしてテキストを返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('  ツイート本文\n\nです  ', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('JINA_API_KEY', '');

    const result = await fetchArticleTextViaJina('https://x.com/user/status/123');

    expect(result).toBe('ツイート本文 です');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://r.jina.ai/https://x.com/user/status/123');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it('JINA_API_KEY があれば bearer トークンを送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('本文', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('JINA_API_KEY', 'secret-token');

    await fetchArticleTextViaJina('https://x.com/user/status/123');

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer secret-token');
  });

  it('空なら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('   ', 'text/plain')));

    expect(await fetchArticleTextViaJina('https://x.com/user/status/123')).toBeUndefined();
  });

  it('取得に失敗したら undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request failed')));

    expect(await fetchArticleTextViaJina('https://x.com/user/status/123')).toBeUndefined();
  });
});

describe('prefersJina', () => {
  it('Twitter/X は r.jina.ai を先に使う', () => {
    for (const url of [
      'https://x.com/user/status/1',
      'https://twitter.com/user/status/1',
      'https://mobile.twitter.com/user/status/1',
      'https://www.x.com/user/status/1',
    ]) {
      expect(prefersJina(url), url).toBe(true);
    }
  });

  it('それ以外のホストは直接取得する', () => {
    for (const url of ['https://example.com/x.com', 'https://notx.com/a', 'https://example.com/']) {
      expect(prefersJina(url), url).toBe(false);
    }
  });
});

describe('fetchArticleText', () => {
  const deps = (direct?: string, viaJina?: string) => ({
    direct: vi.fn().mockResolvedValue(direct),
    viaJina: vi.fn().mockResolvedValue(viaJina),
  });

  it('十分な長さが取れたら直接取得だけで済ませる', async () => {
    const stubs = deps('あ'.repeat(500));

    expect(await fetchArticleText('https://example.com/test', stubs)).toBe('あ'.repeat(500));
    expect(stubs.viaJina).not.toHaveBeenCalled();
  });

  it('直接取得に失敗したら r.jina.ai を使う', async () => {
    const stubs = deps(undefined, 'r.jina.ai の本文');

    expect(await fetchArticleText('https://example.com/test', stubs)).toBe('r.jina.ai の本文');
    expect(stubs.viaJina).toHaveBeenCalledWith('https://example.com/test');
  });

  it('直接取得が短すぎたら r.jina.ai を使う', async () => {
    const stubs = deps('ログインしてください', 'r.jina.ai の本文');

    expect(await fetchArticleText('https://example.com/test', stubs)).toBe('r.jina.ai の本文');
  });

  it('r.jina.ai も失敗したら短い本文を使う', async () => {
    const stubs = deps('短い本文', undefined);

    expect(await fetchArticleText('https://example.com/test', stubs)).toBe('短い本文');
  });

  it('Twitter は r.jina.ai を先に使う', async () => {
    const stubs = deps(undefined, 'ツイート本文');

    expect(await fetchArticleText('https://x.com/user/status/123', stubs)).toBe('ツイート本文');
    expect(stubs.direct).not.toHaveBeenCalled();
  });

  it('Twitter でも r.jina.ai が空なら直接取得に落とす', async () => {
    const stubs = deps('HTMLから取れた本文', undefined);

    expect(await fetchArticleText('https://x.com/user/status/123', stubs)).toBe('HTMLから取れた本文');
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
  it('本文が取れないブックマークは飛ばす', async () => {
    const summarize = vi.fn().mockResolvedValue(digest('要約。'));
    const getArticleText = vi
      .fn()
      .mockResolvedValueOnce('本文あり')
      .mockResolvedValueOnce(undefined);

    const result = await summarizeBookmarks(
      [
        { title: 'A', url: 'https://example.com/1' },
        { title: 'B', url: 'https://example.com/2' },
      ],
      { summarize },
      { intervalMs: 0, getArticleText }
    );

    expect(result.map(([bookmark]) => bookmark.title)).toEqual(['A']);
    expect(summarize).toHaveBeenCalledTimes(1);
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
    summarizeBookmarks: vi
      .fn()
      .mockResolvedValue([[bookmarkA, digest('要約。')]] as SummarizedBookmark[]),
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
      summarizeBookmarks: vi
        .fn()
        .mockResolvedValue([[bookmarkA, digest(SUMMARY_FALLBACK)]] as SummarizedBookmark[]),
    });

    await expect(run({ targetDate: target, postsDir, deps: stubs })).rejects.toThrow(AbortRun);
    expect(stubs.writePost).not.toHaveBeenCalled();
  });

  it('1件でも要約できていれば記事を作る', async () => {
    const ng: Bookmark = { title: 'B', url: 'https://example.com/2' };
    const stubs = deps({
      selectBookmarks: vi.fn().mockReturnValue([bookmarkA, ng]),
      summarizeBookmarks: vi.fn().mockResolvedValue([
        [bookmarkA, digest('要約。')],
        [ng, digest(SUMMARY_FALLBACK)],
      ] as SummarizedBookmark[]),
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
      summarizeBookmarks: vi.fn().mockResolvedValue([]),
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
