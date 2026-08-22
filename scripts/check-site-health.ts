/**
 * 公開中のサイトの異常検知。
 *
 * 公開前ゲート（validate-build.ts）はビルド結果しか見ないので、
 * 「ワークフローが緑のまま記事が作られなくなった」「デプロイが古い成果物を
 * 出し続けている」といった、CI が失敗しないまま静かに壊れる状態は捕まえられない。
 * ここでは実際に公開されている feed.xml を取りに行って、
 *
 *   - サイトが応答するか
 *   - フィードが壊れていないか（空タイトル・URL重複）
 *   - 最新記事が古すぎないか（日次更新が止まっていないか）
 *
 * を確かめる。定期実行して、問題があれば issue を立てるのに使う。
 *
 * 使い方:
 *     npm run health-check -- --feed https://example.com/feed.xml --max-age-hours 36
 */

import { pathToFileURL } from 'node:url';

import { XMLParser } from 'fast-xml-parser';

import {
  formatCivilDate,
  jstDateOf,
  parseCompactCivilDate,
  parseInstant,
  yesterdayInJst,
  type CivilDate,
} from './lib/date.ts';
import { fetchText } from './lib/http.ts';
import { describeError } from './lib/logger.ts';
import { parseFeed as parseBookmarkFeed, type FeedEntry as BookmarkFeedEntry } from './lib/rss.ts';
import { asArray, attrOf, isNode, textOf } from './lib/xml-node.ts';

const DEFAULT_FEED_URL = 'https://6uclz1.github.io/claude-code-blog-site/feed.xml';
const DEFAULT_SOURCE_FEED_URL = 'https://b.hatena.ne.jp/Buchi_6uclz1/rss';

/**
 * 最新記事の許容される古さ（時間）。
 *
 * 日次記事の date は実行時刻ではなく対象日の 09:00 JST に固定されている
 * （scripts/lib/date.ts の postDateStamp）。D日 08:00 JST の実行が作るのは
 * D-1日 09:00 JST の記事なので、健全なら 10:00 JST の点検時点で必ず約25時間前。
 * 1回飛べば約49時間前になる。36時間はその中間で、正常時に鳴らず1回の失敗を逃さない。
 */
const DEFAULT_MAX_AGE_HOURS = 36;

const FETCH_TIMEOUT_MS = 30_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export interface FeedEntry {
  title: string;
  link: string;
  updated?: string;
}

/** Atom フィードから記事を取り出す。読めない形なら例外 */
export function parseFeed(xml: string): FeedEntry[] {
  const parsed: unknown = parser.parse(xml);
  if (!isNode(parsed)) throw new Error('フィードを XML として解釈できません');

  const feed = parsed['feed'];
  if (!isNode(feed)) throw new Error('Atom の <feed> がありません');

  return asArray(feed['entry'])
    .filter(isNode)
    .map((entry) => ({
      title: textOf(entry['title']),
      link: attrOf(asArray(entry['link'])[0], 'href'),
      updated: textOf(entry['updated']) || textOf(entry['published']) || undefined,
    }));
}

export interface CheckOptions {
  maxAgeHours: number;
  minEntries: number;
  now?: Date;
  /** 更新停止と「対象日にブックマークがない正常な停止」を区別するための元RSS */
  sourceFeed?: string;
}

/** フィードの中身を検査して、見つかった異常を日本語で返す */
export function checkEntries(entries: FeedEntry[], options: CheckOptions): string[] {
  const problems: string[] = [];
  const now = options.now ?? new Date();

  if (entries.length < options.minEntries) {
    problems.push(
      `フィードの記事が ${entries.length} 件しかありません（${options.minEntries} 件以上を期待）`
    );
  }

  if (entries.some((entry) => entry.title.trim() === '')) {
    problems.push('タイトルが空の記事がフィードに含まれています');
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.link === '') {
      problems.push('リンクのない記事がフィードに含まれています');
      continue;
    }
    if (seen.has(entry.link)) problems.push(`同じURLの記事が複数あります: ${entry.link}`);
    seen.add(entry.link);
  }

  // 「更新が止まった」を捕まえるのがこの検査の主目的。
  // 最新1件だけ見れば足りる（古い記事の日付は変わらない）
  const newest = newestTimestamp(entries);
  if (entries.length > 0 && newest === undefined) {
    problems.push('フィードの記事に読める日付がありません');
  } else if (newest !== undefined) {
    const ageHours = (now.getTime() - newest.getTime()) / 3_600_000;
    if (ageHours > options.maxAgeHours) {
      problems.push(
        `最新記事が ${Math.floor(ageHours)} 時間前で止まっています` +
          `（${options.maxAgeHours} 時間以内を期待）。自動更新が動いていない可能性があります`
      );
    }
    // 未来の日付は、生成時に実行時刻を使ってしまったときに出る典型的な壊れ方
    if (ageHours < -24) {
      problems.push(`最新記事の日付が未来になっています: ${newest.toISOString()}`);
    }
  }

  return problems;
}

function newestTimestamp(entries: FeedEntry[]): Date | undefined {
  let newest: Date | undefined;
  for (const entry of entries) {
    if (!entry.updated) continue;
    const parsed = new Date(entry.updated);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!newest || parsed > newest) newest = parsed;
  }
  return newest;
}

/** はてなのRSSで実際の記事生成に使われる日付候補を集める */
function bookmarkDates(entry: BookmarkFeedEntry): CivilDate[] {
  const dates: CivilDate[] = [];

  for (const value of [entry.dcDate, entry.published]) {
    const instant = value ? parseInstant(value) : undefined;
    if (instant) dates.push(jstDateOf(instant));
  }

  const compactDate = entry.id ? /\/(\d{8})#/.exec(entry.id)?.[1] : undefined;
  const idDate = compactDate ? parseCompactCivilDate(compactDate) : undefined;
  if (idDate) dates.push(idDate);

  return dates;
}

/**
 * 最後に公開した日より後で、すでに日次生成の対象になったブックマークがあるか。
 *
 * 当日のブックマークは翌朝にまとめるため、まだ記事がなくても異常ではない。
 * 空のRSSは正常だが、壊れたRSSや日付を読めない記事で停止を見逃さないようにする。
 */
export function hasUnpublishedBookmarks(
  xml: string,
  latestPublished: Date,
  now: Date = new Date()
): boolean {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new Error(`RSSを解析できません: ${describeError(error)}`);
  }

  if (
    !isNode(document) ||
    !['rdf:RDF', 'rss', 'feed'].some((root) => isNode(document[root]))
  ) {
    throw new Error('RSSの形式を認識できません');
  }

  const publishedDate = formatCivilDate(jstDateOf(latestPublished));
  const latestExpectedDate = formatCivilDate(yesterdayInJst(now));

  for (const bookmark of parseBookmarkFeed(xml)) {
    const dates = bookmarkDates(bookmark);
    if (dates.length === 0) {
      throw new Error(`ブックマークの日付を読み取れません: ${bookmark.link || '(URLなし)'}`);
    }

    if (
      dates.some((date) => {
        const day = formatCivilDate(date);
        return day > publishedDate && day <= latestExpectedDate;
      })
    ) {
      return true;
    }
  }

  return false;
}

export interface HealthResult {
  ok: boolean;
  problems: string[];
  entryCount: number;
  /** 新しい記事がない原因が、対象日のブックマーク不足だと確認できた */
  sourceIdle?: boolean;
}

export async function checkSite(
  feedUrl: string,
  options: CheckOptions,
  fetchFeed: (url: string) => Promise<string> = (url) =>
    fetchText(url, { timeoutMs: FETCH_TIMEOUT_MS })
): Promise<HealthResult> {
  let xml: string;
  try {
    xml = await fetchFeed(feedUrl);
  } catch (error) {
    // 取得できない時点で以降の検査は無意味なので、ここで打ち切る
    return { ok: false, problems: [`フィードを取得できません: ${describeError(error)}`], entryCount: 0 };
  }

  let entries: FeedEntry[];
  try {
    entries = parseFeed(xml);
  } catch (error) {
    return { ok: false, problems: [`フィードが壊れています: ${describeError(error)}`], entryCount: 0 };
  }

  const problems = checkEntries(entries, options);
  const newest = newestTimestamp(entries);
  const now = options.now ?? new Date();
  const stale =
    newest !== undefined &&
    (now.getTime() - newest.getTime()) / 3_600_000 > options.maxAgeHours;

  if (stale && newest && options.sourceFeed) {
    try {
      const sourceXml = await fetchFeed(options.sourceFeed);
      if (!hasUnpublishedBookmarks(sourceXml, newest, now)) {
        const ageProblem = problems.findIndex((problem) =>
          problem.includes('自動更新が動いていない可能性があります')
        );
        if (ageProblem !== -1) problems.splice(ageProblem, 1);

        return {
          ok: problems.length === 0,
          problems,
          entryCount: entries.length,
          sourceIdle: true,
        };
      }
    } catch (error) {
      problems.push(`ブックマーク元を確認できません: ${describeError(error)}`);
    }
  }

  return { ok: problems.length === 0, problems, entryCount: entries.length };
}

interface CliArgs extends CheckOptions {
  feed: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    feed: DEFAULT_FEED_URL,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    minEntries: 1,
    sourceFeed: DEFAULT_SOURCE_FEED_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    const [flag, inline] = raw.includes('=')
      ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)]
      : [raw, undefined];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next === undefined) throw new Error(`${flag} には値が必要です`);
      return next;
    };
    const numeric = (flag: string) => {
      const parsed = Number(value());
      if (!Number.isFinite(parsed)) throw new Error(`${flag} には数値が必要です`);
      return parsed;
    };

    switch (flag) {
      case '--feed':
        args.feed = value();
        break;
      case '--max-age-hours':
        args.maxAgeHours = numeric(flag);
        break;
      case '--source-feed':
        args.sourceFeed = value();
        break;
      case '--min-entries':
        args.minEntries = numeric(flag);
        break;
      default:
        throw new Error(`不明な引数: ${flag}`);
    }
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 2;
  }

  const result = await checkSite(args.feed, args);
  if (!result.ok) {
    process.stderr.write(`❌ サイトに異常があります (${args.feed}):\n`);
    for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }

  const sourceStatus = result.sourceIdle
    ? '; 前回公開以降に対象日のブックマークはありません'
    : '';
  process.stdout.write(
    `✅ サイトは正常です (${result.entryCount} 件の記事, ${args.feed}${sourceStatus})\n`
  );
  return 0;
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
