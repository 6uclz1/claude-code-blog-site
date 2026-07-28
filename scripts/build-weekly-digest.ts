/**
 * 日次のまとめ記事を1週間分たばねた「週刊まとめ」を生成する。
 *
 * 日次の記事は毎朝流れていくため、1週間経つとトップページから押し出されて
 * 読み返す機会がなくなる。週の終わりに1本だけ振り返り用の記事を作る。
 *
 * 要約はすでに日次の記事にあるので、ここではAIを呼ばずに
 * `_posts/` にある日次記事からブックマークの見出しを集めて並べ直すだけにしている
 * （APIキー不要・毎回同じ出力になるため、失敗しても影響が小さい）。
 *
 * 使い方:
 *     npm run weekly-digest -- [--week-ending YYYY-MM-DD] [--dry-run]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 見出しの読み取りはフィードや /sites/ と同じものを使う。日次記事の見出しは
// 新旧2形式あり、二重に実装すると片方だけ直して静かにズレる
import { extractBookmarks, hostOf, type BookmarkRef } from '../src/lib/bookmarks.ts';

import { AbortRun } from './lib/abort.ts';
import {
  addDays,
  formatCivilDate,
  formatDatePath,
  formatJapaneseDate,
  formatJapaneseMonthDay,
  parseCivilDate,
  postDateStamp,
  yesterdayInJst,
  type CivilDate,
} from './lib/date.ts';
import { buildFrontMatter, splitFrontMatter } from './lib/frontmatter.ts';
import { fileExists } from './lib/fs.ts';
import { describeError, logger } from './lib/logger.ts';

export const POSTS_DIR = '_posts';

/** 日次記事のファイル名（YYYY-MM-DD-hatena-bookmarks.md） */
export const DAILY_SLUG = 'hatena-bookmarks';
export const WEEKLY_SLUG = 'weekly-digest';

/** まとめる日数 */
export const WEEK_DAYS = 7;

/** 「よく読んだサイト」に出す上限 */
export const TOP_HOSTS = 5;

export { AbortRun, extractBookmarks };

export type Bookmark = BookmarkRef;

/** 日次記事1本ぶん */
export interface DailyDigest {
  day: CivilDate;
  bookmarks: Bookmark[];
}

// --------------------------------------------------------------------------
// 日次記事の読み取り
// --------------------------------------------------------------------------

export function dailyPostPath(day: CivilDate, postsDir: string = POSTS_DIR): string {
  return path.join(postsDir, `${formatCivilDate(day)}-${DAILY_SLUG}.md`);
}

/** その日の日次記事を読む。無ければ undefined（休みの日もあるので異常ではない） */
export async function readDailyDigest(
  day: CivilDate,
  postsDir: string = POSTS_DIR
): Promise<DailyDigest | undefined> {
  const filePath = dailyPostPath(day, postsDir);
  if (!(await fileExists(filePath))) return undefined;

  const { body } = splitFrontMatter(await readFile(filePath, 'utf-8'));
  const bookmarks = extractBookmarks(body);
  if (bookmarks.length === 0) {
    logger.warn(`No bookmarks found in ${filePath}`);
    return undefined;
  }

  return { day, bookmarks };
}

/** end を最終日とする7日分の日次記事を古い順に集める */
export async function collectWeek(
  end: CivilDate,
  postsDir: string = POSTS_DIR
): Promise<DailyDigest[]> {
  const days = Array.from({ length: WEEK_DAYS }, (_, index) =>
    addDays(end, index - (WEEK_DAYS - 1))
  );
  const digests = await Promise.all(days.map((day) => readDailyDigest(day, postsDir)));
  return digests.filter((digest): digest is DailyDigest => digest !== undefined);
}

// --------------------------------------------------------------------------
// 週刊記事の生成
// --------------------------------------------------------------------------

export function weekStart(end: CivilDate): CivilDate {
  return addDays(end, -(WEEK_DAYS - 1));
}

export function postPath(end: CivilDate, postsDir: string = POSTS_DIR): string {
  return path.join(postsDir, `${formatCivilDate(end)}-${WEEKLY_SLUG}.md`);
}

/** その週によく読んだサイト（2件以上のものだけ） */
export function topHosts(digests: DailyDigest[], limit: number = TOP_HOSTS): [string, number][] {
  const counts = new Map<string, number>();
  for (const digest of digests) {
    for (const bookmark of digest.bookmarks) {
      // 旧形式の見出しはURLを持たないことがある
      const host = bookmark.url ? hostOf(bookmark.url) : undefined;
      if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }

  // 件数の降順。同数のときは最初に出てきたホストを先にする（Counter.most_common と同じ）
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .filter(([, count]) => count > 1);
}

/** 週刊まとめのMarkdownを組み立てる */
export function renderPost(digests: DailyDigest[], end: CivilDate): string {
  const start = weekStart(end);
  const total = digests.reduce((sum, digest) => sum + digest.bookmarks.length, 0);
  const span = `${formatJapaneseDate(start)}〜${formatJapaneseMonthDay(end)}`;

  const frontMatter = buildFrontMatter({
    title: `週刊まとめ ${span} (${total}件)`,
    date: postDateStamp(end),
    permalink: `/${formatDatePath(end)}/${WEEKLY_SLUG}/`,
    excerpt: `${span}にブックマークした${total}件を、日別に並べ直しました。`,
  });

  const sections: string[] = [];

  const hosts = topHosts(digests);
  if (hosts.length > 0) {
    const lines = ['**よく読んだサイト**', ''];
    lines.push(...hosts.map(([host, count]) => `- ${host} (${count}件)`));
    sections.push(lines.join('\n'));
  }

  for (const digest of digests) {
    const block = [`## ${formatJapaneseDate(digest.day)} (${digest.bookmarks.length}件)`, ''];
    for (const bookmark of digest.bookmarks) {
      block.push(bookmark.url ? `- [${bookmark.title}](${bookmark.url})` : `- ${bookmark.title}`);
    }
    sections.push(block.join('\n'));
  }

  sections.push(
    '---\n\n' +
      '*日次のまとめ記事から自動生成しています。' +
      '各記事の要約はその日のまとめをご覧ください。*'
  );

  return `${frontMatter}\n${sections.join('\n\n')}\n`;
}

/** 週刊まとめを書き出す。作成したら true */
export async function writePost(
  digests: DailyDigest[],
  end: CivilDate,
  postsDir: string = POSTS_DIR
): Promise<boolean> {
  if (digests.length === 0) {
    logger.info('No daily posts in the week, skipping');
    return false;
  }

  const filePath = postPath(end, postsDir);
  if (await fileExists(filePath)) {
    logger.warn(`Weekly post already exists, keeping it: ${filePath}`);
    return false;
  }

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, renderPost(digests, end), 'utf-8');
  } catch (error) {
    logger.error(`Error creating weekly post: ${describeError(error)}`);
    return false;
  }

  logger.info(`Created weekly digest: ${filePath} from ${digests.length} daily posts`);
  return true;
}

// --------------------------------------------------------------------------
// エントリポイント
// --------------------------------------------------------------------------

export interface RunOptions {
  end?: CivilDate;
  dryRun?: boolean;
  postsDir?: string;
}

/** メイン処理。作成した記事数（0 or 1）を返す */
export async function run(options: RunOptions = {}): Promise<number> {
  const end = options.end ?? yesterdayInJst();
  const postsDir = options.postsDir ?? POSTS_DIR;
  const dryRun = options.dryRun ?? false;

  logger.info(
    `Building weekly digest for ${formatCivilDate(weekStart(end))} - ${formatCivilDate(end)}`
  );

  if (!dryRun && (await fileExists(postPath(end, postsDir)))) {
    logger.warn(`Weekly post for ${formatCivilDate(end)} already exists, nothing to do`);
    return 0;
  }

  const digests = await collectWeek(end, postsDir);
  if (digests.length === 0) {
    // 日次の記事が1本も無い週。日次側の失敗が続いている可能性が高い
    throw new AbortRun(
      `${formatCivilDate(weekStart(end))}〜${formatCivilDate(end)} の日次記事が1本も見つからないため、週刊まとめを作成しません`
    );
  }

  if (dryRun) {
    process.stdout.write(`${renderPost(digests, end)}\n`);
    return 0;
  }

  return (await writePost(digests, end, postsDir)) ? 1 : 0;
}

export interface CliArgs {
  weekEnding?: CivilDate;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    const [flag, inlineValue] = arg.startsWith('--week-ending=')
      ? arg.split('=', 2)
      : [arg, undefined];
    if (flag === '--week-ending') {
      const value = inlineValue ?? argv[++index];
      const parsed = value ? parseCivilDate(value) : undefined;
      if (!parsed) {
        throw new AbortRun(`--week-ending は YYYY-MM-DD で指定してください: ${value ?? ''}`);
      }
      args.weekEnding = parsed;
      continue;
    }
    throw new AbortRun(`不明な引数: ${arg}`);
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    await run({ end: args.weekEnding, dryRun: args.dryRun });
  } catch (error) {
    if (error instanceof AbortRun) {
      logger.error(error.message);
      return 1;
    }
    throw error;
  }
  return 0;
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
