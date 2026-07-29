/** 公開中のサイトの異常検知(scripts/check-site-health.ts)のテスト */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkEntries,
  checkSite,
  main,
  parseArgs,
  parseFeed,
  type FeedEntry,
} from '../scripts/check-site-health.ts';
import { okResponse } from './helpers.ts';

const HOUR = 3_600_000;
const NOW = new Date('2026-07-28T00:00:00Z');

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function feed(...entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}
</feed>
`;
}

function entry({
  title = 'はてなブックマーク 2026年07月27日 の記事まとめ',
  href = 'https://example.com/2026/07/27/hatena-bookmarks/',
  updated = hoursAgo(6),
} = {}): string {
  return `
  <entry>
    <title type="html">${title}</title>
    <link href="${href}" rel="alternate" type="text/html"/>
    <published>${updated}</published>
    <updated>${updated}</updated>
  </entry>`;
}

const options = { maxAgeHours: 36, minEntries: 1, now: NOW };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseFeed', () => {
  it('タイトル・リンク・日付を取り出す', () => {
    const [parsed] = parseFeed(feed(entry({ title: 'まとめ', href: 'https://example.com/a/' })));

    expect(parsed).toMatchObject({ title: 'まとめ', link: 'https://example.com/a/' });
  });

  it('記事が1件でも配列で返す', () => {
    expect(parseFeed(feed(entry()))).toHaveLength(1);
  });

  it('記事が複数でも全部返す', () => {
    expect(parseFeed(feed(entry(), entry({ href: 'https://example.com/b/' })))).toHaveLength(2);
  });

  it('記事がなければ空配列', () => {
    expect(parseFeed(feed())).toEqual([]);
  });

  it('<feed> でなければ例外', () => {
    expect(() => parseFeed('<rss><channel/></rss>')).toThrow(/feed/);
  });
});

describe('checkEntries', () => {
  const entries = (...items: Partial<FeedEntry>[]): FeedEntry[] =>
    items.map((item) => ({
      title: 'まとめ',
      link: 'https://example.com/a/',
      updated: hoursAgo(6),
      ...item,
    }));

  it('正常なフィードは問題なしとする', () => {
    expect(checkEntries(entries({}), options)).toEqual([]);
  });

  it('最新記事が古すぎたら止まっていると判断する', () => {
    const problems = checkEntries(entries({ updated: hoursAgo(72) }), options);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/自動更新が動いていない/);
  });

  it('しきい値ちょうどは正常とする', () => {
    expect(checkEntries(entries({ updated: hoursAgo(36) }), options)).toEqual([]);
  });

  it('最新記事が新しければ古い記事があっても問題にしない', () => {
    expect(
      checkEntries(
        entries({ updated: hoursAgo(6) }, { link: 'https://example.com/b/', updated: hoursAgo(900) }),
        options
      )
    ).toEqual([]);
  });

  it('未来の日付を見つける', () => {
    const problems = checkEntries(entries({ updated: hoursAgo(-48) }), options);

    expect(problems.join()).toMatch(/未来/);
  });

  it('空のタイトルを見つける', () => {
    expect(checkEntries(entries({ title: '  ' }), options).join()).toMatch(/タイトルが空/);
  });

  it('URLの重複を見つける', () => {
    const problems = checkEntries(entries({}, {}), options);

    expect(problems.join()).toMatch(/同じURLの記事/);
  });

  it('リンクのない記事を見つける', () => {
    expect(checkEntries(entries({ link: '' }), options).join()).toMatch(/リンクのない記事/);
  });

  it('記事が足りなければ問題にする', () => {
    expect(checkEntries([], { ...options, minEntries: 1 }).join()).toMatch(/記事が 0 件/);
  });

  it('日付の読めない記事しかなければ問題にする', () => {
    expect(checkEntries(entries({ updated: undefined }), options).join()).toMatch(/読める日付/);
  });
});

describe('checkSite', () => {
  it('正常なサイトは ok を返す', async () => {
    const result = await checkSite('https://example.com/feed.xml', options, async () =>
      feed(entry())
    );

    expect(result).toMatchObject({ ok: true, entryCount: 1 });
  });

  it('取得できなければ ok=false（以降の検査はしない）', async () => {
    const result = await checkSite('https://example.com/feed.xml', options, async () => {
      throw new Error('HTTP 503');
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['フィードを取得できません: HTTP 503']);
  });

  it('フィードが壊れていれば ok=false', async () => {
    const result = await checkSite('https://example.com/feed.xml', options, async () => '<rss/>');

    expect(result.ok).toBe(false);
    expect(result.problems.join()).toMatch(/壊れています/);
  });

  it('既定では実際に HTTP で取りに行く', async () => {
    const fetchMock = vi.fn(async () => okResponse(feed(entry()), 'application/xml'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkSite('https://example.com/feed.xml', options);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });
});

describe('parseArgs', () => {
  it('既定値を持つ', () => {
    expect(parseArgs([])).toMatchObject({ maxAgeHours: 36, minEntries: 1 });
  });

  it('引数を読む', () => {
    expect(parseArgs(['--feed', 'https://example.com/f.xml', '--max-age-hours=48'])).toMatchObject({
      feed: 'https://example.com/f.xml',
      maxAgeHours: 48,
    });
  });

  it('知らない引数は例外', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/不明な引数/);
  });
});

describe('main', () => {
  it('正常なら 0 を返す', async () => {
    // main() は options を受け取らず実時刻で判定するため、記事の日時も実時刻から
    // 作る。固定の NOW を使うと、その時刻から36時間経った日にこのテストが落ちる。
    const fresh = entry({ updated: new Date(Date.now() - 6 * HOUR).toISOString() });
    vi.stubGlobal('fetch', async () => okResponse(feed(fresh), 'application/xml'));
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    expect(await main(['--feed', 'https://example.com/feed.xml'])).toBe(0);
  });

  it('異常があれば 1 を返す', async () => {
    vi.stubGlobal('fetch', async () => okResponse(feed(), 'application/xml'));
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(await main(['--feed', 'https://example.com/feed.xml'])).toBe(1);
  });

  it('引数が不正なら 2 を返す', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(await main(['--nope'])).toBe(2);
  });
});
