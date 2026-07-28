/**
 * ビルド結果を公開前に検証するスクリプト。
 *
 * ビルドが成功しても記事が壊れたまま公開されることがあるため
 * (タイトルなし・URL衝突・記事の消失)、ビルドログと生成された feed.xml を
 * 機械的に検査して、問題があれば非ゼロで終了する。
 *
 * 使い方:
 *     npm run validate -- --log build.log --feed dist/feed.xml --dist dist
 */

import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';

import { fileExists, isDirectory, listFilesRecursively } from './lib/fs.ts';
import { describeError } from './lib/logger.ts';
import { asArray, attrOf, isNode, textOf } from './lib/xml-node.ts';

// Astro はファイルへリダイレクトしても色付けのエスケープシーケンスを出すため、
// パターンマッチの前に取り除く
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** ビルドログに出たら公開を止めるパターン */
const LOG_PATTERNS: [RegExp, string][] = [
  [/\[ERROR\]/g, 'ビルドがエラーを報告している'],
  [
    /InvalidContentEntryDataError|does not match collection schema/g,
    'フロントマターがスキーマに合わない記事がある',
  ],
  [/YAMLException|YAML Exception/g, 'フロントマターのYAMLが壊れている記事がある'],
  [/permalink が重複|Duplicate route/g, '複数の記事が同じURLに出力されている(片方が消える)'],
];

/** 記事のURLは /YYYY/MM/DD/slug/ 形式 */
const POST_URL_RE = /\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/;

/** dist の中の記事ページ: YYYY/MM/DD/slug/index.html */
const POST_PAGE_RE = /^\d{4}\/\d{2}\/\d{2}\/[^/]+\/index\.html$/;

/**
 * フロントマターが壊れた記事はビルド時刻を持つため、同一秒のentryが束になって現れる。
 * 過去の記事が偶然同じ時刻を持っていても異常ではないので、
 * 「ビルド時刻に近い」ものだけを異常として扱う。
 */
const BUILD_TIME_WINDOW_MS = 6 * 60 * 60 * 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Astroのビルドログを検査する */
export async function checkLog(logPath: string | undefined, errors: string[]): Promise<void> {
  if (!logPath) return;
  if (!(await fileExists(logPath))) {
    errors.push(`ビルドログが見つからない: ${logPath}`);
    return;
  }

  const log = (await readFile(logPath, 'utf-8')).replace(ANSI_RE, '');

  for (const [pattern, message] of LOG_PATTERNS) {
    const hits = log.match(pattern);
    if (hits) errors.push(`ビルドログ: ${message} (${hits.length}件)`);
  }
}

/** dist に出力された記事ページ (YYYY/MM/DD/slug/index.html) の数 */
async function countPostPages(distDir: string): Promise<number> {
  const files = await listFilesRecursively(distDir);
  return files.filter((relative) => POST_PAGE_RE.test(relative)).length;
}

/**
 * _posts の記事がすべてページとして出力されているかを検査する。
 *
 * feed.xml は最新20件しか載らないため、それより古い記事が消えても
 * feed の検査では気づけない。ここで件数を突き合わせる。
 */
export async function checkPages(
  distDir: string | undefined,
  postsDir: string,
  errors: string[]
): Promise<void> {
  if (!distDir) return;
  if (!(await isDirectory(distDir))) {
    errors.push(`ビルド結果が見つからない: ${distDir}`);
    return;
  }
  if (!(await isDirectory(postsDir))) {
    errors.push(`記事ディレクトリが見つからない: ${postsDir}`);
    return;
  }

  const sources = (await readdir(postsDir)).filter(
    (name) => name.endsWith('.md') && !name.startsWith('.')
  );
  const generated = await countPostPages(distDir);

  // 1記事につき1ページ。少なければ記事が読み込まれずに落ちている
  if (generated < sources.length) {
    errors.push(
      `記事の出力数が足りない: _posts ${sources.length}件に対して ${generated} ページ ` +
        `(${sources.length - generated}件が公開されない)`
    );
  }
}

/** タイムゾーンの指定がない日時は UTC として読む（環境のTZで結果が変わらないように） */
function parsePublished(value: string): Date | undefined {
  const text = value.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = new Date(hasZone ? text : `${text}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** 生成された feed.xml を検査する */
export async function checkFeed(
  feedPath: string,
  errors: string[],
  minEntries = 1,
  now: Date = new Date()
): Promise<void> {
  if (!(await fileExists(feedPath))) {
    errors.push(`feed.xml が生成されていない: ${feedPath}`);
    return;
  }

  const xml = await readFile(feedPath, 'utf-8');
  // パーサは壊れたXMLでも黙って読み進めてしまうため、先に構文を検査する
  // （閉じタグの欠落などは例外で返ってくる）
  try {
    const validity = SyntaxValidator.validate(xml);
    if (validity !== true) {
      errors.push(`feed.xml がXMLとして壊れている: ${validity.err.msg}`);
      return;
    }
  } catch (error) {
    errors.push(`feed.xml がXMLとして壊れている: ${describeError(error)}`);
    return;
  }

  const document: unknown = parser.parse(xml);
  const feed = isNode(document) ? document['feed'] : undefined;
  const entries = asArray(isNode(feed) ? feed['entry'] : undefined).filter(isNode);

  if (entries.length < minEntries) {
    errors.push(`feed.xml のentryが少なすぎる: ${entries.length}件 (最低${minEntries}件)`);
    return;
  }

  const links: string[] = [];
  const publishedAt: number[] = [];

  entries.forEach((entry, index) => {
    const title = textOf(entry['title']);
    const href = attrOf(asArray(entry['link'])[0], 'href');
    const label = href || `entry #${index + 1}`;

    // フロントマターが壊れた記事はタイトルが空になる
    if (!title) errors.push(`feed.xml: タイトルが空のentryがある: ${label}`);

    if (!href) {
      errors.push(`feed.xml: linkがないentryがある: entry #${index + 1}`);
    } else {
      links.push(href);
      const afterScheme = href.split('://').pop() ?? '';
      const slash = afterScheme.indexOf('/');
      const pathPart = slash === -1 ? '' : afterScheme.slice(slash);
      if (!POST_URL_RE.test(pathPart)) {
        errors.push(`feed.xml: URLの形式が想定と違う: ${href}`);
      }
    }

    const published = textOf(entry['published']);
    if (!published) {
      errors.push(`feed.xml: publishedがないentryがある: ${label}`);
      return;
    }
    const parsed = parsePublished(published);
    if (!parsed) {
      errors.push(`feed.xml: publishedが日付として読めない: ${published} (${label})`);
      return;
    }
    // 未来日付は時計ずれ以外ありえない
    if (parsed.getTime() > now.getTime() + 60 * 60 * 1000) {
      errors.push(`feed.xml: publishedが未来になっている: ${published} (${label})`);
    }
    publishedAt.push(parsed.getTime());
  });

  const duplicates = [...new Set(links.filter((link, _, all) => all.indexOf(link) !== all.lastIndexOf(link)))].sort();
  for (const link of duplicates) {
    errors.push(`feed.xml: URLが重複している(記事が上書きされている): ${link}`);
  }

  // 壊れた記事はビルド時刻を持つため、同一秒のentryが束になって現れる
  if (publishedAt.length >= 2) {
    const newest = Math.max(...publishedAt);
    const sameSecond = publishedAt.filter((time) => time === newest);
    if (sameSecond.length > 1 && Math.abs(now.getTime() - newest) <= BUILD_TIME_WINDOW_MS) {
      errors.push(
        `feed.xml: publishedが同一時刻のentryが${sameSecond.length}件ある(ビルド時刻が入り込んでいる可能性)`
      );
    }
  }
}

export interface CliArgs {
  log?: string;
  feed: string;
  minEntries: number;
  dist?: string;
  posts: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { feed: 'dist/feed.xml', minEntries: 1, posts: '_posts' };

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

    switch (flag) {
      case '--log':
        args.log = value();
        break;
      case '--feed':
        args.feed = value();
        break;
      case '--min-entries':
        args.minEntries = Number(value());
        break;
      case '--dist':
        args.dist = value();
        break;
      case '--posts':
        args.posts = value();
        break;
      default:
        throw new Error(`不明な引数: ${raw}`);
    }
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  const errors: string[] = [];
  await checkLog(args.log, errors);
  await checkFeed(args.feed, errors, args.minEntries);
  await checkPages(args.dist, args.posts, errors);

  if (errors.length > 0) {
    process.stderr.write('❌ 検証に失敗しました。サイトを公開しません:\n');
    for (const error of errors) process.stderr.write(`  - ${error}\n`);
    return 1;
  }

  process.stdout.write('✅ 検証OK: ビルドログ・feed.xml に問題はありません\n');
  return 0;
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
