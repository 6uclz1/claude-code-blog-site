/**
 * はてなブックマークの前日分を Gemini で要約し、1本のまとめ記事を生成する。
 *
 * この記事は「朝にパラッと目を通す」ためのものなので、分量を絞ることを最優先にしている。
 * 1ブックマークあたり "1行サマリ + 箇条書き最大3点" に固定し、
 * モデルの出力が長すぎる場合はスクリプト側で切り詰める（プロンプトだけでは長さが安定しないため）。
 *
 * 各段階の実装は scripts/lib/ にある。このファイルはそれらをつなぐだけ:
 *   - bookmark-feed.ts  RSS の取得と対象日のブックマークの選別
 *   - article-fetch.ts  記事本文の取得（経路の選択と定型文の除外）
 *   - gemini.ts         要約の生成と整形
 *
 * 使い方:
 *     npm run summarize -- [--date YYYY-MM-DD] [--dry-run]
 *
 * `--date` を付けないときは前日分に加えて、その前 CATCH_UP_DAYS 日のうち記事が
 * 無い日も作り直す（Gemini の一時的な障害などで1日落ちても、翌日以降の実行で埋まる）。
 */

import path from 'node:path';

import { AbortRun } from './lib/abort.ts';
import { fetchArticle, type ArticleContent, type ArticleOutcome } from './lib/article-fetch.ts';
import {
  fetchEntries,
  memoizeFetchEntries,
  rssUrlForDate,
  selectBookmarks,
  type Bookmark,
} from './lib/bookmark-feed.ts';
import { parseFlags, runIfMain } from './lib/cli.ts';
import {
  addDays,
  formatCivilDate,
  formatDatePath,
  formatJapaneseDate,
  jstDateOf,
  parseCivilDate,
  postDateStamp,
  yesterdayInJst,
  type CivilDate,
} from './lib/date.ts';
import { buildFrontMatter } from './lib/frontmatter.ts';
import { fileExists, writeFileIfAbsent } from './lib/fs.ts';
import { GeminiSummarizer, SUMMARY_FALLBACK, type Digest, type Summarizer } from './lib/gemini.ts';
import { describeError, logger } from './lib/logger.ts';
import { markdownLink } from './lib/markdown.ts';
import type { FeedEntry } from './lib/rss.ts';
import { sleep } from './lib/sleep.ts';
import { appendJobSummary } from './lib/summary.ts';
// 表示用のタイトル整形はサイト側（フィード・/sites/）と同じ実装を使う
import { displayTitle } from '../src/lib/url.ts';

// 既存の呼び出し側（テスト・ドキュメント）が import 元を変えずに済むよう、
// 分割した各段階の公開APIをここからも出す
export * from './lib/article-fetch.ts';
export * from './lib/bookmark-feed.ts';
export * from './lib/gemini.ts';
export { AbortRun, yesterdayInJst };

export const POSTS_DIR = '_posts';
/**
 * 前日分に加えて、記事が無ければ作り直す過去の日数。
 * RSS には直近の数十件しか載らないので、遠い日付を見てもブックマークは見つからない。
 * 2026-10-28 は要約APIの一時的な障害で落ち、翌日の実行は前日分しか見ないため埋まらなかった。
 */
export const CATCH_UP_DAYS = 3;

/** Gemini のレート制限対策（記事ごとの待機） */
export const API_INTERVAL_MS = 2_000;

export type SummarizedBookmark = [Bookmark, Digest];

// --------------------------------------------------------------------------
// 記事生成
// --------------------------------------------------------------------------

export function postPath(target: CivilDate, postsDir: string = POSTS_DIR): string {
  return path.join(postsDir, `${formatCivilDate(target)}-hatena-bookmarks.md`);
}

/** まとめ記事のMarkdownを組み立てる */
export function renderPost(digests: SummarizedBookmark[], target: CivilDate): string {
  const count = digests.length;
  const dateLabel = formatJapaneseDate(target);

  const frontMatter = buildFrontMatter({
    // タイトル・date・パーマリンクをすべてブックマーク日から生成する。
    // 実行時刻を混ぜると、ビルド環境のタイムゾーンや実行時間帯によって
    // /:year/:month/:day/ が翌日にずれ、翌日分の記事とURLが衝突してしまう。
    title: `はてなブックマーク ${dateLabel} の記事まとめ (${count}件)`,
    date: postDateStamp(target),
    permalink: `/${formatDatePath(target)}/hatena-bookmarks/`,
    excerpt: `${dateLabel}にブックマークした${count}件を、1行ずつまとめました。`,
  });

  // 本文の導入文は置かない。タイトルに日付と件数が入っており、
  // 一覧やフィードには excerpt が出るので、記事側で繰り返すと読む量が増えるだけ。
  const sections = digests.map(([bookmark, entry]) => {
    // タイトルがURLのまま（元記事のタイトルが取れなかった）ときは
    // パーセントエンコードを解いて、見出しの日本語が読める形にする
    const block = [
      `## ${markdownLink(displayTitle(bookmark.title), bookmark.url)}`,
      '',
      entry.summary,
    ];
    if (entry.points.length > 0) {
      block.push('', ...entry.points.map((point) => `- ${point}`));
    }
    return block.join('\n');
  });

  sections.push(
    '---\n\n' +
      '*はてなブックマークのRSSから自動生成しています。' +
      '要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*'
  );

  return `${frontMatter}\n${sections.join('\n\n')}\n`;
}

/** まとめ記事を書き出す。作成したら true、スキップ・失敗なら false */
export async function writePost(
  digests: SummarizedBookmark[],
  target: CivilDate,
  postsDir: string = POSTS_DIR
): Promise<boolean> {
  if (digests.length === 0) {
    logger.info('No entries to summarize, skipping post creation');
    return false;
  }

  const filePath = postPath(target, postsDir);
  let created: boolean;
  try {
    created = await writeFileIfAbsent(filePath, renderPost(digests, target));
  } catch (error) {
    logger.error(`Error creating daily post: ${describeError(error)}`);
    return false;
  }

  if (!created) {
    // run() でも先に検査しているので、ここに来るのは postsDir を差し替えた
    // 呼び出しだけ。上書きすると既存記事を失うため必ず残す。
    logger.warn(`Post already exists, keeping the existing file: ${filePath}`);
    return false;
  }

  logger.info(`Created daily blog post: ${filePath} with ${digests.length} articles`);
  return true;
}

// --------------------------------------------------------------------------
// 本文取得 + 要約
// --------------------------------------------------------------------------

export interface SummarizeBookmarksOptions {
  intervalMs?: number;
  getArticle?: (url: string) => Promise<ArticleOutcome>;
  wait?: (ms: number) => Promise<void>;
}

/** 記事に載せられなかったブックマークと、その理由 */
export interface SkippedBookmark {
  bookmark: Bookmark;
  reason: string;
}

export interface SummarizeResult {
  digests: SummarizedBookmark[];
  /** 落ちたものを黙って捨てると、記事に穴が空いたことに誰も気づけない */
  skipped: SkippedBookmark[];
}

/**
 * 各ブックマークの本文を取得して要約する。
 *
 * 本文が取れなかったもの・要約に失敗したものは記事に載せない
 * （「要約を生成できませんでした」だけの見出しは読む人にとって価値が無く、
 * フロントマターは正常なので公開前ゲートでも気づけない）。
 * 代わりに理由を添えて `skipped` に集め、呼び出し側が報告する。
 */
export async function summarizeBookmarks(
  bookmarks: Bookmark[],
  summarizer: Summarizer,
  options: SummarizeBookmarksOptions = {}
): Promise<SummarizeResult> {
  const intervalMs = options.intervalMs ?? API_INTERVAL_MS;
  const getArticle = options.getArticle ?? ((url: string) => fetchArticle(url));
  const wait = options.wait ?? sleep;

  const digests: SummarizedBookmark[] = [];
  const skipped: SkippedBookmark[] = [];

  for (const [index, bookmark] of bookmarks.entries()) {
    logger.info(`Processing: ${bookmark.title}`);
    const outcome = await getArticle(bookmark.url);
    if (!outcome.ok) {
      logger.warn(`Skipping ${bookmark.url}: ${outcome.reason}`);
      skipped.push({ bookmark, reason: outcome.reason });
      continue;
    }

    // 取得経路がタイトルを持っていて、はてなのタイトルがURLのままなら差し替える
    const titled = withResolvedTitle(bookmark, outcome.content);
    const entry = await summarizer.summarize(titled, outcome.content.text);
    if (entry.summary === SUMMARY_FALLBACK) {
      skipped.push({ bookmark: titled, reason: '要約の生成に失敗' });
    } else {
      digests.push([titled, entry]);
    }

    if (intervalMs && index < bookmarks.length - 1) await wait(intervalMs);
  }

  return { digests, skipped };
}

/** はてなのRSSがタイトルを持たない（URLがそのまま入っている）ときだけ差し替える */
export function withResolvedTitle(bookmark: Bookmark, content: ArticleContent): Bookmark {
  if (!content.title) return bookmark;
  const title = bookmark.title.trim();
  if (title && !/^https?:\/\//i.test(title)) return bookmark;
  return { ...bookmark, title: content.title };
}

/** 記事に載らなかったブックマークをログとジョブサマリに出す */
async function reportSkipped(skipped: SkippedBookmark[], total: number): Promise<void> {
  logger.warn(`${total}件中${skipped.length}件を記事に載せられませんでした:`);
  for (const { bookmark, reason } of skipped) {
    logger.warn(`  - ${bookmark.url}: ${reason}`);
  }

  // `|` を含むタイトルは表の列を割ってしまうのでエスケープする
  const cell = (text: string) => displayTitle(text).replace(/\|/g, '\\|');
  const rows = skipped.map(
    ({ bookmark, reason }) =>
      `| ${bookmark.title ? cell(bookmark.title) : '(タイトルなし)'} | ${bookmark.url} | ${reason} |`
  );
  await appendJobSummary(
    [
      `### 記事に載せられなかったブックマーク (${skipped.length}/${total}件)`,
      '',
      '| タイトル | URL | 理由 |',
      '| --- | --- | --- |',
      ...rows,
    ].join('\n')
  );
}

// --------------------------------------------------------------------------
// エントリポイント
// --------------------------------------------------------------------------

/** run() が呼び出す処理。テストから差し替えられるようにまとめてある */
export interface RunDeps {
  fetchEntries: (rssUrl?: string) => Promise<FeedEntry[]>;
  selectBookmarks: (entries: FeedEntry[], target: CivilDate) => Bookmark[];
  summarizeBookmarks: (bookmarks: Bookmark[], summarizer: Summarizer) => Promise<SummarizeResult>;
  writePost: (
    digests: SummarizedBookmark[],
    target: CivilDate,
    postsDir: string
  ) => Promise<boolean>;
  createSummarizer: (apiKey: string) => Summarizer;
}

const defaultDeps: RunDeps = {
  fetchEntries: (rssUrl) => fetchEntries(rssUrl),
  selectBookmarks,
  summarizeBookmarks: (bookmarks, summarizer) => summarizeBookmarks(bookmarks, summarizer),
  writePost,
  createSummarizer: (apiKey) => new GeminiSummarizer(apiKey),
};

export interface RunOptions {
  targetDate?: CivilDate;
  /**
   * 対象日のブックマークが通常のRSSに無いとき、日付を指定したRSS
   * （`?date=YYYYMMDD`）も見る。手動で古い日を作り直すとき用
   */
  searchByDate?: boolean;
  dryRun?: boolean;
  postsDir?: string;
  deps?: Partial<RunDeps>;
}

/**
 * メイン処理。作成した記事数（0 or 1）を返す。
 * 記事を作れない異常（設定不備・要約の全滅）は AbortRun を投げる。
 */
export async function run(options: RunOptions = {}): Promise<number> {
  const deps: RunDeps = { ...defaultDeps, ...options.deps };
  const postsDir = options.postsDir ?? POSTS_DIR;
  const dryRun = options.dryRun ?? false;

  logger.info('Starting Hatena Bookmark summarization process');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AbortRun('GEMINI_API_KEY environment variable is not set');

  const target = options.targetDate ?? yesterdayInJst();

  const entries = await deps.fetchEntries();
  if (entries.length === 0) {
    logger.warn('No entries found in RSS feed');
    return 0;
  }

  let bookmarks = deps.selectBookmarks(entries, target);
  if (bookmarks.length === 0 && options.searchByDate) {
    // 通常のRSSは直近の数十件だけなので、古い日は日付を指定して取り直す。
    // はてな側がパラメータを無視しても同じフィードが返るだけで害は無い
    const dated = await deps.fetchEntries(rssUrlForDate(target));
    bookmarks = deps.selectBookmarks(dated, target);
  }
  if (bookmarks.length === 0) {
    logger.info(`No entries from ${formatCivilDate(target)} found`);
    return 0;
  }

  // 既にその日の記事があるなら要約する必要はない（APIも呼ばない）。
  // 再実行では正常な流れなので止めないが、無言だと「なぜ増えていないのか」が
  // 分からないため警告として残す。
  const filePath = postPath(target, postsDir);
  if (!dryRun && (await fileExists(filePath))) {
    logger.warn(`Post for ${formatCivilDate(target)} already exists, nothing to do: ${filePath}`);
    return 0;
  }

  const { digests, skipped } = await deps.summarizeBookmarks(
    bookmarks,
    deps.createSummarizer(apiKey)
  );

  // 落ちたブックマークはログとジョブサマリの両方に残す。ワークフローが成功したまま
  // 記事から数件消えるのがいちばん気づきにくい壊れ方なので、必ず表に出す。
  if (skipped.length > 0) await reportSkipped(skipped, bookmarks.length);

  // ブックマークはあったのに1件も記事にできていない状態。記事が作られないまま
  // ワークフローが成功扱いで終わると、穴が空いたことに誰も気づけないので止める。
  // （中身が「要約を生成できませんでした」だけの記事はフロントマターもURLも
  // 正常なため、公開前ゲート(validate-build.ts)まで進むと検知できない）
  if (digests.length === 0) {
    throw new AbortRun(
      `${bookmarks.length}件のブックマークすべてで本文取得か要約に失敗し、記事を作成しません ` +
        '(取得先の仕様変更・ネットワーク・APIキー・レート制限を確認してください)\n' +
        skipped.map(({ bookmark, reason }) => `  - ${bookmark.url}: ${reason}`).join('\n')
    );
  }

  if (dryRun) {
    process.stdout.write(`${renderPost(digests, target)}\n`);
    return 0;
  }

  return (await deps.writePost(digests, target, postsDir)) ? 1 : 0;
}

/**
 * 前日より前で、記事が無い日を作り直す。
 *
 * ここでの失敗は報告するだけで終了コードにしない。前日分の記事は作れているので、
 * 過去の穴埋めの失敗でそのコミットまで止める理由が無い。
 * 作り直せた日・作れなかった日はジョブサマリにも残す。
 */
export async function catchUp(
  today: CivilDate,
  options: { days?: number; postsDir?: string; deps?: Partial<RunDeps> } = {}
): Promise<number> {
  const days = options.days ?? CATCH_UP_DAYS;
  const postsDir = options.postsDir ?? POSTS_DIR;
  let created = 0;
  const failures: string[] = [];

  for (let back = 2; back <= days + 1; back += 1) {
    const target = addDays(today, -back);
    if (await fileExists(postPath(target, postsDir))) continue;

    logger.info(`Catching up missing post for ${formatCivilDate(target)}`);
    try {
      const count = await run({ targetDate: target, postsDir, deps: options.deps });
      if (count > 0) logger.warn(`Recreated missing post for ${formatCivilDate(target)}`);
      created += count;
    } catch (error) {
      const message = describeError(error);
      logger.warn(`Could not catch up ${formatCivilDate(target)}: ${message}`);
      failures.push(`- ${formatCivilDate(target)}: ${message.split('\n')[0]}`);
    }
  }

  if (failures.length > 0) {
    await appendJobSummary(['### 過去の欠けた日の作り直しに失敗', '', ...failures].join('\n'));
  }
  return created;
}

export interface CliArgs {
  date?: CivilDate;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  const abort = (message: string) => new AbortRun(message);

  parseFlags(
    argv,
    {
      '--dry-run': () => {
        args.dryRun = true;
      },
      '--date': (value) => {
        const raw = value();
        const parsed = parseCivilDate(raw);
        if (!parsed) throw abort(`--date は YYYY-MM-DD で指定してください: ${raw}`);
        args.date = parsed;
      },
    },
    abort
  );

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.date) {
      await run({ targetDate: args.date, dryRun: args.dryRun, searchByDate: true });
    } else {
      const fetchEntriesOnce = memoizeFetchEntries((rssUrl) => fetchEntries(rssUrl));
      const deps = { fetchEntries: fetchEntriesOnce };
      await run({ dryRun: args.dryRun, deps });
      // 前日分が失敗したら AbortRun で抜けるので、ここには来ない
      if (!args.dryRun) await catchUp(jstDateOf(new Date()), { deps });
    }
  } catch (error) {
    if (error instanceof AbortRun) {
      logger.error(error.message);
      return 1;
    }
    throw error;
  }
  return 0;
}

runIfMain(import.meta.url, main);
