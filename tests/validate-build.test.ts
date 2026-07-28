/** 公開前ゲート(scripts/validate-build.ts)のテスト */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkFeed, checkLog, checkPages, main } from '../scripts/validate-build.ts';
import { createTempDir } from './helpers.ts';

const FEED_HEADER =
  '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">';

function entry({
  title = 'はてなブックマーク 2026年07月25日 の記事まとめ (9件)',
  href = 'https://example.com/blog/2026/07/25/hatena-bookmarks/',
  published = '2026-07-25T23:56:15+00:00',
} = {}): string {
  return `
  <entry>
    <title type="html">${title}</title>
    <link href="${href}" rel="alternate" type="text/html"/>
    <published>${published}</published>
    <updated>${published}</updated>
  </entry>`;
}

const feed = (...entries: string[]) => `${FEED_HEADER}${entries.join('')}\n</feed>\n`;

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

let tmp: { dir: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  tmp = await createTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
  vi.restoreAllMocks();
});

async function write(name: string, content: string): Promise<string> {
  const filePath = path.join(tmp.dir, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('checkLog', () => {
  const errorsFor = async (log: string) => {
    const errors: string[] = [];
    await checkLog(await write('build.log', log), errors);
    return errors;
  };

  it('問題のないログは通す', async () => {
    expect(await errorsFor('[build] 361 page(s) built in 5.41s\n')).toEqual([]);
  });

  it('YAMLの破損を見つける', async () => {
    const errors = await errorsFor(
      'YAMLException: end of the stream or a document separator is expected ' +
        '(_posts/2025-12-18-hatena-bookmarks.md)\n'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('YAML');
  });

  it('スキーマ不一致を見つける', async () => {
    const errors = await errorsFor(
      '[ERROR] [InvalidContentEntryDataError] posts → 2025-12-18-hatena-bookmarks ' +
        'data does not match collection schema.\n'
    );

    // [ERROR] とスキーマ不一致の両方に当たる
    expect(errors).toHaveLength(2);
    expect(errors.some((error) => error.includes('スキーマ'))).toBe(true);
  });

  it('URLの衝突を見つける', async () => {
    const errors = await errorsFor(
      'Error: permalink が重複しています: /2026/07/07/hatena-bookmarks/ ' +
        '(2026-07-07-hatena-bookmarks.md と 2026-07-07-bookmark-summary.md)\n'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('同じURL');
  });

  it('色付きのログでも見つける', async () => {
    // Astro はファイルへリダイレクトしても色付けコードを出す
    const errors = await errorsFor(
      '\u001b[31m[ERROR]\u001b[0m Could not render /2026/07/07/hatena-bookmarks/\n'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('エラー');
  });

  it('ログが無ければ報告する', async () => {
    const errors: string[] = [];
    await checkLog('/nonexistent/build.log', errors);

    expect(errors).toHaveLength(1);
  });
});

describe('checkFeed', () => {
  const errorsFor = async (content: string, minEntries = 1) => {
    const errors: string[] = [];
    await checkFeed(await write('feed.xml', content), errors, minEntries);
    return errors;
  };

  it('正常なフィードは通す', async () => {
    const content = feed(
      entry(),
      entry({
        title: 'はてなブックマーク 2026年07月24日 の記事まとめ (4件)',
        href: 'https://example.com/blog/2026/07/24/hatena-bookmarks/',
        published: '2026-07-24T23:58:57+00:00',
      })
    );

    expect(await errorsFor(content)).toEqual([]);
  });

  it('タイトルが空のentryを見つける', async () => {
    // フロントマターが壊れた記事はタイトルが空になる
    const errors = await errorsFor(feed(entry({ title: '' }), entry()));

    expect(errors.some((error) => error.includes('タイトルが空'))).toBe(true);
  });

  it('URLの重複を見つける', async () => {
    // URL衝突は片方の記事が上書きされて消えることを意味する
    const errors = await errorsFor(
      feed(entry(), entry({ published: '2026-07-24T23:58:57+00:00' }))
    );

    expect(errors.some((error) => error.includes('重複'))).toBe(true);
  });

  it('未来の published を見つける', async () => {
    const errors = await errorsFor(feed(entry({ published: isoAgo(-2 * 24 * 60 * 60 * 1000) })));

    expect(errors.some((error) => error.includes('未来'))).toBe(true);
  });

  it('ビルド時刻が入り込んだ同一秒のentryを見つける', async () => {
    const stamp = isoAgo(60 * 1000);
    const errors = await errorsFor(
      feed(
        entry({ href: 'https://example.com/blog/2026/07/26/a-post/', published: stamp }),
        entry({ href: 'https://example.com/blog/2026/07/26/b-post/', published: stamp })
      )
    );

    expect(errors.some((error) => error.includes('同一時刻'))).toBe(true);
  });

  it('過去の同一秒は通す', async () => {
    // 過去の記事がたまたま同時刻でも、ビルド時刻の混入ではない
    const stamp = isoAgo(30 * 24 * 60 * 60 * 1000);
    const errors = await errorsFor(
      feed(
        entry({ href: 'https://example.com/blog/2026/07/26/a-post/', published: stamp }),
        entry({ href: 'https://example.com/blog/2026/07/26/b-post/', published: stamp })
      )
    );

    expect(errors.some((error) => error.includes('同一時刻'))).toBe(false);
  });

  it('想定と違うURL形式を見つける', async () => {
    const errors = await errorsFor(
      feed(entry({ href: 'https://example.com/blog/2026/07/26/2025-12-18-hatena-bookmarks' }))
    );

    expect(errors.some((error) => error.includes('形式'))).toBe(true);
  });

  it('壊れたXMLを見つける', async () => {
    const errors = await errorsFor(`${FEED_HEADER}${entry()}\n`); // 閉じタグなし

    expect(errors.some((error) => error.includes('XML'))).toBe(true);
  });

  it('feed.xml が無いことを見つける', async () => {
    const errors: string[] = [];
    await checkFeed(path.join(tmp.dir, 'nope.xml'), errors);

    expect(errors.some((error) => error.includes('生成されていない'))).toBe(true);
  });

  it('entryが少なすぎることを見つける', async () => {
    const errors = await errorsFor(feed(entry()), 5);

    expect(errors.some((error) => error.includes('少なすぎる'))).toBe(true);
  });
});

describe('checkPages', () => {
  let dist: string;
  let posts: string;

  beforeEach(async () => {
    dist = path.join(tmp.dir, 'dist');
    posts = path.join(tmp.dir, '_posts');
    await mkdir(posts, { recursive: true });
  });

  const addPost = (name: string) => writeFile(path.join(posts, name), '---\ntitle: t\n---\n', 'utf-8');
  const addPage = async (relative: string) => {
    const dir = path.join(dist, ...relative.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<html></html>', 'utf-8');
  };
  const errorsFor = async () => {
    const errors: string[] = [];
    await checkPages(dist, posts, errors);
    return errors;
  };

  it('全記事が出力されていれば通す', async () => {
    await addPost('2026-07-25-hatena-bookmarks.md');
    await addPost('2026-07-26-hatena-bookmarks.md');
    await addPage('2026/07/25/hatena-bookmarks');
    await addPage('2026/07/26/hatena-bookmarks');
    // 一覧ページは記事として数えない
    await addPage('page2');

    expect(await errorsFor()).toEqual([]);
  });

  it('出力されていない記事を見つける', async () => {
    // feed.xml は最新20件しか見ないため、古い記事の消失はここで捕まえる
    await addPost('2026-07-25-hatena-bookmarks.md');
    await addPost('2026-07-26-hatena-bookmarks.md');
    await addPage('2026/07/26/hatena-bookmarks');

    expect((await errorsFor()).some((error) => error.includes('出力数が足りない'))).toBe(true);
  });

  it('dist が無いことを見つける', async () => {
    await addPost('2026-07-26-hatena-bookmarks.md');

    expect((await errorsFor()).some((error) => error.includes('ビルド結果が見つからない'))).toBe(true);
  });

  it('--dist を渡さなければ検査しない', async () => {
    const errors: string[] = [];
    await checkPages(undefined, posts, errors);

    expect(errors).toEqual([]);
  });
});

describe('main', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  it('問題がなければ 0 を返す', async () => {
    const feedPath = await write('feed.xml', feed(entry()));

    expect(await main(['--feed', feedPath])).toBe(0);
  });

  it('壊れていれば 1 を返す', async () => {
    const feedPath = await write('feed.xml', feed(entry({ title: '' })));

    expect(await main(['--feed', feedPath])).toBe(1);
  });
});
