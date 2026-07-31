import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AbortRun,
  collectWeek,
  extractBookmarks,
  postPath,
  readDailyDigest,
  renderPost,
  run,
  topHosts,
  weekStart,
  writePost,
  type DailyDigest,
} from '../scripts/build-weekly-digest.ts';
import { civilDate } from '../scripts/lib/date.ts';
import { fileExists } from '../scripts/lib/fs.ts';
import { bodyOf, createTempDir, frontMatterOf } from './helpers.ts';

// 現在の日次記事の形式
const NEW_FORMAT = `---
title: はてなブックマーク 2026年07月20日 の記事まとめ (2件)
---

## [記事A](https://example.com/a)

要約A

## [記事B](https://blog.example.org/b)

要約B
`;

// 既存記事の形式（見出しに番号、URLは次の行）
const OLD_FORMAT = `---
title: はてなブックマーク 2026年07月21日 の記事まとめ (1件)
---

## 1. 記事C

**URL:** [https://example.com/c](https://example.com/c)

### AI要約

要点：
*   なにか
`;

// 週刊まとめが使うのはタイトルとURLだけ。
// summary（共有用の説明文で使う）も付いてくるので toMatchObject で見る。
describe('extractBookmarks', () => {
  it('現在の形式を読む', () => {
    expect(extractBookmarks(bodyOf(NEW_FORMAT))).toMatchObject([
      { title: '記事A', url: 'https://example.com/a' },
      { title: '記事B', url: 'https://blog.example.org/b' },
    ]);
  });

  it('旧形式は次の行からURLを補う', () => {
    expect(extractBookmarks(bodyOf(OLD_FORMAT))).toMatchObject([
      { title: '記事C', url: 'https://example.com/c' },
    ]);
  });

  it('セクション見出しは拾わない', () => {
    expect(extractBookmarks('## 要点\n\n### AI要約\n')).toEqual([]);
  });

  it('URLの無い採番見出しも残す', () => {
    expect(extractBookmarks('## 1. 記事D\n\n本文\n')).toMatchObject([{ title: '記事D' }]);
  });
});

describe('collectWeek', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> };
  let postsDir: string;

  beforeEach(async () => {
    tmp = await createTempDir();
    postsDir = path.join(tmp.dir, '_posts');
    await mkdir(postsDir);
  });
  afterEach(() => tmp.cleanup());

  const writeDaily = (day: string, content: string) =>
    writeFile(path.join(postsDir, `${day}-hatena-bookmarks.md`), content, 'utf-8');

  it('存在する日だけを古い順に集める', async () => {
    await writeDaily('2026-07-20', NEW_FORMAT);
    await writeDaily('2026-07-21', OLD_FORMAT);
    // 対象期間の外なので拾わない
    await writeDaily('2026-07-19', NEW_FORMAT);

    const digests = await collectWeek(civilDate(2026, 7, 26), postsDir);

    expect(digests.map((digest) => digest.day)).toEqual([
      civilDate(2026, 7, 20),
      civilDate(2026, 7, 21),
    ]);
  });

  it('1本も無ければ空', async () => {
    expect(await collectWeek(civilDate(2026, 7, 26), postsDir)).toEqual([]);
  });

  it('ブックマークが無い記事は飛ばす', async () => {
    await writeDaily('2026-07-20', '---\ntitle: t\n---\n\n本文だけ\n');

    expect(await readDailyDigest(civilDate(2026, 7, 20), postsDir)).toBeUndefined();
  });
});

describe('renderPost', () => {
  const digests: DailyDigest[] = [
    {
      day: civilDate(2026, 7, 20),
      bookmarks: [
        { title: '記事A', url: 'https://example.com/a' },
        { title: '記事B', url: 'https://example.com/b' },
      ],
    },
    {
      day: civilDate(2026, 7, 21),
      bookmarks: [{ title: '記事C', url: 'https://other.example/c' }],
    },
  ];
  const markdown = renderPost(digests, civilDate(2026, 7, 26));

  it('front matter を週から作る', () => {
    const front = frontMatterOf(markdown);

    expect(String(front.title)).toContain('(3件)');
    expect(front.permalink).toBe('/2026/07/26/weekly-digest/');
    // 実行時刻ではなく週の最終日から決める（表示日付とURLをそろえる）
    expect(front.date).toBe('2026-07-26 09:00:00 +0900');
  });

  it('日別にブックマークを並べる', () => {
    const body = bodyOf(markdown);

    expect(body).toContain('## 2026年07月20日 (2件)');
    expect(body).toContain('- [記事A](https://example.com/a)');
    expect(body).toContain('## 2026年07月21日 (1件)');
  });

  it('URLの無いブックマークはただのテキストにする', () => {
    const withoutUrl = renderPost(
      [{ day: civilDate(2026, 7, 20), bookmarks: [{ title: '記事D' }] }],
      civilDate(2026, 7, 26)
    );

    expect(bodyOf(withoutUrl)).toContain('- 記事D\n');
  });

  it('よく読んだサイトは2件以上のものだけ', () => {
    expect(
      topHosts([
        {
          day: civilDate(2026, 7, 20),
          bookmarks: [
            { title: 'a', url: 'https://example.com/1' },
            { title: 'b', url: 'https://example.com/2' },
            { title: 'c', url: 'https://once.example/3' },
          ],
        },
      ])
    ).toEqual([['example.com', 2]]);
  });
});

describe('writePost', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> };
  let postsDir: string;
  const end = civilDate(2026, 7, 26);
  const digests: DailyDigest[] = [
    { day: civilDate(2026, 7, 20), bookmarks: [{ title: '記事A', url: 'https://example.com/a' }] },
  ];

  beforeEach(async () => {
    tmp = await createTempDir();
    postsDir = path.join(tmp.dir, '_posts');
  });
  afterEach(() => tmp.cleanup());

  it('ファイルを作る', async () => {
    expect(await writePost(digests, end, postsDir)).toBe(true);
    expect(await fileExists(postPath(end, postsDir))).toBe(true);
  });

  it('既存ファイルは残す', async () => {
    const filePath = postPath(end, postsDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'existing', 'utf-8');

    expect(await writePost(digests, end, postsDir)).toBe(false);
    expect(await readFile(filePath, 'utf-8')).toBe('existing');
  });

  it('日次記事が無ければ作らない', async () => {
    expect(await writePost([], end, postsDir)).toBe(false);
  });
});

describe('run', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> };
  let postsDir: string;
  const end = civilDate(2026, 7, 26);

  beforeEach(async () => {
    tmp = await createTempDir();
    postsDir = path.join(tmp.dir, '_posts');
    await mkdir(postsDir);
  });
  afterEach(() => tmp.cleanup());

  const writeDaily = (day: string) =>
    writeFile(path.join(postsDir, `${day}-hatena-bookmarks.md`), NEW_FORMAT, 'utf-8');

  it('週刊まとめを作る', async () => {
    await writeDaily('2026-07-20');

    expect(await run({ end, postsDir })).toBe(1);
    expect(await fileExists(postPath(end, postsDir))).toBe(true);
  });

  it('日次記事が1本も無ければ中断する', async () => {
    await expect(run({ end, postsDir })).rejects.toThrow(AbortRun);
  });

  it('既にある週刊まとめは残す', async () => {
    const filePath = postPath(end, postsDir);
    await writeFile(filePath, 'existing', 'utf-8');
    await writeDaily('2026-07-20');

    expect(await run({ end, postsDir })).toBe(0);
    expect(await readFile(filePath, 'utf-8')).toBe('existing');
  });

  it('--dry-run では書き込まない', async () => {
    await writeDaily('2026-07-20');
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    expect(await run({ end, dryRun: true, postsDir })).toBe(0);
    expect(String(write.mock.calls[0]![0])).toContain('## 2026年07月20日 (2件)');
    write.mockRestore();
    expect(await fileExists(postPath(end, postsDir))).toBe(false);
  });
});

describe('weekStart', () => {
  it('最終日を含む7日間', () => {
    expect(weekStart(civilDate(2026, 7, 26))).toEqual(civilDate(2026, 7, 20));
  });
});
