/**
 * はてなブックマークの前日分を Gemini で要約し、1本のまとめ記事を生成する。
 *
 * この記事は「朝にパラッと目を通す」ためのものなので、分量を絞ることを最優先にしている。
 * 1ブックマークあたり "1行サマリ + 箇条書き最大3点" に固定し、
 * モデルの出力が長すぎる場合はスクリプト側で切り詰める（プロンプトだけでは長さが安定しないため）。
 *
 * 使い方:
 *     npm run summarize -- [--date YYYY-MM-DD] [--dry-run]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';

import { AbortRun } from './lib/abort.ts';
import { extractArticleText, type ArticleContent } from './lib/article.ts';
import { boilerplateReason } from './lib/boilerplate.ts';
import {
  formatCivilDate,
  formatDatePath,
  formatJapaneseDate,
  isSameDate,
  jstDateOf,
  parseCivilDate,
  parseCompactCivilDate,
  parseInstant,
  postDateStamp,
  yesterdayInJst,
  type CivilDate,
} from './lib/date.ts';
import { buildFrontMatter } from './lib/frontmatter.ts';
import { fileExists } from './lib/fs.ts';
import { decodeBody, fetchBytes, fetchText, isTextLike, USER_AGENT } from './lib/http.ts';
import { describeError, logger } from './lib/logger.ts';
import { markdownLink } from './lib/markdown.ts';
import { parseFeed, type FeedEntry } from './lib/rss.ts';
import {
  fetchTweet,
  isTwitterUrl,
  parseTweetRef,
  tweetText,
  tweetTitle,
} from './lib/sources/twitter.ts';
import { appendJobSummary } from './lib/summary.ts';
// 表示用のタイトル整形はサイト側（フィード・/sites/）と同じ実装を使う
import { displayTitle } from '../src/lib/url.ts';

export const RSS_URL = 'https://b.hatena.ne.jp/Buchi_6uclz1/rss';
export const GEMINI_MODEL = 'gemini-2.5-flash';
export const POSTS_DIR = '_posts';

// 記事本文の取得まわり
export const HTTP_TIMEOUT_MS = 15_000;
/** 記事取得のリトライ（429/5xx のみ。404 は待っても変わらないので即諦める） */
export const ARTICLE_RETRY_COUNT = 1;
// RSS取得のリトライ（はてな側が不調でもその日の記事を落とさないため）
export const RSS_RETRY_COUNT = 3;
export const RSS_RETRY_WAIT_MS = 2_000;
export const ARTICLE_TEXT_LIMIT = 3000;
// 本文として採用する最低文字数。これを下回るときは取得失敗とみなして
// 次の経路を試す（ログイン誘導やCookie同意だけのページ対策）
export const MIN_ARTICLE_TEXT_CHARS = 200;

// r.jina.ai 経由の取得
// JavaScriptでレンダリングされるサイトは HTML を直接取っても本文が無いため、
// レンダリング済みのテキストを返してくれる r.jina.ai を使う。
export const JINA_READER_PREFIX = 'https://r.jina.ai/';
export const JINA_TIMEOUT_MS = 30_000;

// 要約の分量。ここを変えると記事全体のボリュームが変わる
export const SUMMARY_MAX_CHARS = 120;
export const POINT_MAX_CHARS = 45;
export const MAX_POINTS = 3;

/** Gemini のレート制限対策（記事ごとの待機） */
export const API_INTERVAL_MS = 2_000;

export const SUMMARY_FALLBACK = '要約を生成できませんでした。詳しくは元記事をご覧ください。';

export { AbortRun };

/** ブックマーク1件（RSSエントリから必要な情報だけ取り出したもの） */
export interface Bookmark {
  title: string;
  url: string;
}

/** 1件分の短い要約。summary は1行、points は箇条書き（最大 MAX_POINTS 件） */
export interface Digest {
  summary: string;
  points: string[];
}

export type SummarizedBookmark = [Bookmark, Digest];

export const digest = (summary: string, points: string[] = []): Digest => ({ summary, points });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------------------
// 日付
// --------------------------------------------------------------------------

export { yesterdayInJst };

/**
 * エントリが持つ日付の候補をすべて集める。
 *
 * はてなのRSSは dc:date / エントリID（/user/20250620#bookmark-xxx）/ published が
 * それぞれ食い違うことがあるため、どれか1つでも対象日と一致すれば採用する。
 */
export function entryDatesJst(entry: FeedEntry): CivilDate[] {
  const candidates: CivilDate[] = [];

  if (entry.dcDate) {
    const parsed = parseInstant(entry.dcDate);
    if (parsed) candidates.push(jstDateOf(parsed));
    else logger.info(`Unparsable dc:date: ${entry.dcDate}`);
  }

  if (entry.id) {
    const match = /\/(\d{8})#/.exec(entry.id);
    const parsed = match?.[1] ? parseCompactCivilDate(match[1]) : undefined;
    if (parsed) candidates.push(parsed);
  }

  if (entry.published) {
    const parsed = parseInstant(entry.published);
    if (parsed) candidates.push(jstDateOf(parsed));
    else logger.info(`Unparsable published: ${entry.published}`);
  }

  return candidates;
}

// --------------------------------------------------------------------------
// RSS
// --------------------------------------------------------------------------

export interface FetchEntriesOptions {
  /** テストから待ち時間を潰すために差し替える */
  wait?: (ms: number) => Promise<void>;
}

/**
 * RSSフィードのエントリを取得する（失敗時は空リスト）。
 *
 * 取得先が応答しないとジョブがそのままハングするため、必ずタイムアウトを付け、
 * 一時的な失敗ではその日の記事を落とさないようリトライする。
 */
export async function fetchEntries(
  rssUrl: string = RSS_URL,
  options: FetchEntriesOptions = {}
): Promise<FeedEntry[]> {
  const wait = options.wait ?? sleep;

  for (let attempt = 1; attempt <= RSS_RETRY_COUNT; attempt += 1) {
    try {
      logger.info(`Fetching RSS from ${rssUrl} (attempt ${attempt}/${RSS_RETRY_COUNT})`);
      const { bytes, contentType } = await fetchBytes(rssUrl, { timeoutMs: HTTP_TIMEOUT_MS });
      const entries = parseFeed(decodeBody(bytes, contentType));
      if (entries.length === 0) logger.warn('Feed parsing produced no entries, but continuing...');
      return entries;
    } catch (error) {
      logger.error(`Error fetching RSS: ${describeError(error)}`);
      if (attempt < RSS_RETRY_COUNT) await wait(RSS_RETRY_WAIT_MS * attempt);
    }
  }

  return [];
}

/** 対象日のエントリを Bookmark に変換する（同一URLは先勝ちで重複排除） */
export function selectBookmarks(entries: FeedEntry[], target: CivilDate): Bookmark[] {
  const bookmarks: Bookmark[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const title = entry.title ?? '';
    const url = entry.link ?? '';
    if (!url) {
      logger.warn(`Skipping entry without link: ${title || 'Unknown'}`);
      continue;
    }

    const dates = entryDatesJst(entry);
    if (dates.length === 0) {
      logger.warn(`No date found for entry: ${title || 'Unknown'}`);
      continue;
    }
    if (!dates.some((date) => isSameDate(date, target))) continue;
    if (seen.has(url)) {
      logger.info(`Skipping duplicated bookmark: ${url}`);
      continue;
    }

    seen.add(url);
    bookmarks.push({ title, url });
    logger.info(`Found entry for ${formatCivilDate(target)}: ${title}`);
  }

  logger.info(`Selected ${bookmarks.length} entries for ${formatCivilDate(target)}`);
  return bookmarks;
}

// --------------------------------------------------------------------------
// 記事本文
// --------------------------------------------------------------------------

/** 記事のHTMLを直接取得して本文を抽出する。取得できなければ undefined */
export async function fetchArticleDirect(url: string): Promise<ArticleContent | undefined> {
  try {
    const { bytes, contentType } = await fetchBytes(url, {
      timeoutMs: HTTP_TIMEOUT_MS,
      retries: ARTICLE_RETRY_COUNT,
    });
    // PDF や画像を cheerio に渡してもゴミしか出ない
    if (!isTextLike(contentType)) {
      logger.warn(`Not a text document (${contentType}): ${url}`);
      return undefined;
    }
    const text = extractArticleText(decodeBody(bytes, contentType), ARTICLE_TEXT_LIMIT);
    if (!text) {
      logger.warn(`No content extracted from ${url}`);
      return undefined;
    }
    return { text, source: 'direct' };
  } catch (error) {
    // 1記事の失敗で全体を止めない
    logger.error(`Error extracting content from ${url}: ${describeError(error)}`);
    return undefined;
  }
}

/**
 * r.jina.ai 経由でレンダリング済みのテキストを取得する。取得できなければ undefined。
 *
 * JINA_API_KEY があれば付与する（レート制限が緩くなる）。無くても動く。
 */
export async function fetchArticleViaJina(url: string): Promise<ArticleContent | undefined> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    // Markdownのリンクや画像記法は要約に不要なので、プレーンテキストで受け取る
    'X-Return-Format': 'text',
  };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    // 対象URLは r.jina.ai のパスとして繋ぐ。`#` はそのまま渡すとフラグメントとして
    // 切り落とされ、別のページを取りに行ってしまうのでエスケープする
    const body = await fetchText(JINA_READER_PREFIX + url.replace(/#/g, '%23'), {
      headers,
      timeoutMs: JINA_TIMEOUT_MS,
      retries: ARTICLE_RETRY_COUNT,
    });
    const text = body.replace(/\s+/g, ' ').trim();
    if (!text) {
      logger.warn(`No content extracted via r.jina.ai from ${url}`);
      return undefined;
    }
    return { text: text.slice(0, ARTICLE_TEXT_LIMIT), source: 'r.jina.ai' };
  } catch (error) {
    logger.error(`Error extracting content via r.jina.ai from ${url}: ${describeError(error)}`);
    return undefined;
  }
}

/**
 * Twitter/X のポストを専用の経路で取得する。
 *
 * はてなのRSSはポストのタイトルをURLのまま返すことが多いので、
 * 見出し用のタイトルも一緒に返す。
 */
export async function fetchArticleFromTwitter(url: string): Promise<ArticleContent | undefined> {
  const ref = parseTweetRef(url);
  if (!ref) return undefined;

  const tweet = await fetchTweet(ref);
  if (!tweet) return undefined;

  return { text: tweetText(tweet), title: tweetTitle(tweet), source: 'twitter' };
}

/** 本文の取得経路。上から順に試す */
export interface ArticleFetchers {
  twitter: (url: string) => Promise<ArticleContent | undefined>;
  direct: (url: string) => Promise<ArticleContent | undefined>;
  jina: (url: string) => Promise<ArticleContent | undefined>;
}

export const defaultFetchers: ArticleFetchers = {
  twitter: fetchArticleFromTwitter,
  direct: fetchArticleDirect,
  jina: fetchArticleViaJina,
};

export interface FetchStep {
  fetcher: keyof ArticleFetchers;
  /** これ以上の長さが取れたらその場で採用する */
  minChars: number;
}

/**
 * URLごとの取得手順を決める。空配列なら「取得しても意味が無いURL」。
 *
 * ホストごとの事情はここに集約する。取得経路を増やすときは
 * ArticleFetchers に足してこの表に並べれば済むようにしてある。
 */
export function fetchPlan(url: string): FetchStep[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  if (isTwitterUrl(parsed)) {
    // プロフィールやトレンドのURLは要約する本文が存在しない。
    // 取りに行っても「JavaScriptを有効にしてください」しか返ってこないので、
    // 記事に載せる価値のある結果は得られない
    if (!parseTweetRef(url)) return [];
    // ポストは140字程度のこともあるため、長さでは足切りしない
    return [
      { fetcher: 'twitter', minChars: 1 },
      { fetcher: 'jina', minChars: MIN_ARTICLE_TEXT_CHARS },
      { fetcher: 'direct', minChars: MIN_ARTICLE_TEXT_CHARS },
    ];
  }

  return [
    { fetcher: 'direct', minChars: MIN_ARTICLE_TEXT_CHARS },
    { fetcher: 'jina', minChars: MIN_ARTICLE_TEXT_CHARS },
  ];
}

/** 本文取得の結果。失敗した理由は run() がまとめて報告する */
export type ArticleOutcome =
  | { ok: true; content: ArticleContent }
  | { ok: false; reason: string };

/**
 * 記事の本文を取得する。
 *
 * 取得できた「だけ」では採用しない。ログイン誘導・JavaScript必須の案内・
 * r.jina.ai のエラー通知はどれも 200 で返ってくるうえ、そのまま要約すると
 * 記事の内容とは無関係な要約が出来上がるため、定型文を弾いてから次の経路に進む。
 */
export async function fetchArticle(
  url: string,
  fetchers: ArticleFetchers = defaultFetchers
): Promise<ArticleOutcome> {
  const plan = fetchPlan(url);
  if (plan.length === 0) return { ok: false, reason: '本文のあるURLではない' };

  const reasons: string[] = [];
  // どの経路も規定の長さに届かなかったときに使う、いちばんマシな結果
  let fallback: ArticleContent | undefined;

  for (const step of plan) {
    const content = await fetchers[step.fetcher](url);
    if (!content?.text) {
      reasons.push(`${step.fetcher}: 本文が取れない`);
      continue;
    }

    const boilerplate = boilerplateReason(content.text);
    if (boilerplate) {
      logger.warn(`Rejected ${step.fetcher} result for ${url}: ${boilerplate}`);
      reasons.push(`${step.fetcher}: ${boilerplate}`);
      continue;
    }

    if (content.text.length >= step.minChars) return { ok: true, content };

    reasons.push(`${step.fetcher}: 本文が短い(${content.text.length}文字)`);
    if (!fallback || content.text.length > fallback.text.length) fallback = content;
  }

  // 短くても定型文ではない本文が残っていれば、それを使う
  if (fallback) return { ok: true, content: fallback };
  return { ok: false, reason: reasons.join(' / ') };
}

// --------------------------------------------------------------------------
// 要約
// --------------------------------------------------------------------------

export const PROMPT_TEMPLATE = `あなたは技術ブログの朝刊コーナーの編集者です。
読者が出勤前に数十秒で全体を把握できるよう、次の記事を短くまとめてください。

制約:
- summary: 記事の要点を1文で。{summary_max}文字以内。体言止めや「〜する内容」のような要約調で簡潔に。
- points: 補足したい具体的な情報を最大{max_points}個。各{point_max}文字以内の短い句。無ければ空配列。
- 前置き・感想・元記事へのリンク案内は書かない。
- 専門用語は必要な範囲で残しつつ、平易な日本語にする。

次のJSONのみを出力してください:
{"summary": "...", "points": ["...", "..."]}

タイトル: {title}
URL: {url}

記事内容:
{content}
`;

export function buildPrompt(bookmark: Bookmark, articleText: string): string {
  const values: Record<string, string> = {
    summary_max: String(SUMMARY_MAX_CHARS),
    point_max: String(POINT_MAX_CHARS),
    max_points: String(MAX_POINTS),
    // パーセントエンコードのままのタイトルは Gemini にも読めないので戻す
    title: displayTitle(bookmark.title),
    url: bookmark.url,
    content: articleText,
  };
  // 出力例の JSON にも `{...}` が出てくるので、既知のキーだけを置き換える
  return PROMPT_TEMPLATE.replace(/\{(summary_max|point_max|max_points|title|url|content)\}/g,
    (_, key: string) => values[key] ?? '');
}

/** 箇条書き記号や余分な空白・強調記法を落として1行にする */
function normalize(text: unknown): string {
  let value = String(text ?? '').replace(/\s+/g, ' ').trim();
  value = value.replace(/^[-*・•\d]+[.)]?\s*/, '');
  return value.replace(/\*\*/g, '').trim();
}

/** limit 文字以内に収める。文の途中で切れないよう句点を優先する */
function shorten(text: unknown, limit: number): string {
  const value = normalize(text);
  if (value.length <= limit) return value;

  const head = value.slice(0, limit);
  const sentenceEnd = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
  if (sentenceEnd >= Math.floor(limit / 2)) return head.slice(0, sentenceEnd + 1);
  // 末尾の「…」も1文字分なので、その分だけ短く切る
  return `${value.slice(0, limit - 1).replace(/\s+$/, '')}…`;
}

/** モデル出力からJSONオブジェクトを取り出す（```json フェンス付きにも対応） */
function extractJson(raw: string): Record<string, unknown> | undefined {
  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]+?)```/.exec(text);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** モデル出力を Digest に変換する。JSONで返らなかった場合は本文の先頭を使う */
export function parseDigest(raw: string): Digest {
  const payload = extractJson(raw) ?? {};

  let summary = shorten(payload.summary ?? '', SUMMARY_MAX_CHARS);
  if (!summary) {
    // JSONとして壊れていても、プレーンテキストの1行目が使えることが多い
    const firstLine = raw.split('\n').find((line) => normalize(line)) ?? '';
    summary = shorten(firstLine, SUMMARY_MAX_CHARS);
  }

  const rawPoints = payload.points ?? [];
  const candidates = Array.isArray(rawPoints) ? rawPoints : [rawPoints];

  const points: string[] = [];
  for (const candidate of candidates) {
    const shortened = shorten(candidate, POINT_MAX_CHARS);
    if (shortened && shortened !== summary) points.push(shortened);
    if (points.length >= MAX_POINTS) break;
  }

  return digest(summary || SUMMARY_FALLBACK, points);
}

/**
 * 要約リクエストの生成設定。
 *
 * SDKの型を通して組み立てるので、設定名がSDKのバージョンに存在しなくなれば
 * 型チェック（npm run check）で気づける。
 */
export function generationConfig(): GenerateContentConfig {
  return {
    responseMimeType: 'application/json',
    temperature: 0.2,
  };
}

export interface Summarizer {
  summarize(bookmark: Bookmark, articleText: string): Promise<Digest>;
}

/** テストから差し替えられるよう、SDKのうち実際に使う部分だけを型にしている */
export interface GenerativeClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: GenerateContentConfig;
    }): Promise<{ text?: string | undefined }>;
  };
}

/** Gemini で1件分の短い要約を作る */
export class GeminiSummarizer implements Summarizer {
  private readonly client: GenerativeClient;
  private readonly model: string;

  constructor(
    apiKey: string,
    options: { model?: string; client?: GenerativeClient } = {}
  ) {
    this.client = options.client ?? new GoogleGenAI({ apiKey });
    this.model = options.model ?? GEMINI_MODEL;
  }

  async summarize(bookmark: Bookmark, articleText: string): Promise<Digest> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildPrompt(bookmark, articleText),
        config: generationConfig(),
      });
      return parseDigest(response.text ?? '');
    } catch (error) {
      // 1記事の失敗で全体を止めない
      logger.error(`Error generating summary for ${bookmark.url}: ${describeError(error)}`);
      return digest(SUMMARY_FALLBACK);
    }
  }
}

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
      block.push('');
      block.push(...entry.points.map((point) => `- ${point}`));
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
  if (await fileExists(filePath)) {
    // run() でも先に検査しているので、ここに来るのは postsDir を差し替えた
    // 呼び出しだけ。上書きすると既存記事を失うため必ず残す。
    logger.warn(`Post already exists, keeping the existing file: ${filePath}`);
    return false;
  }

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, renderPost(digests, target), 'utf-8');
  } catch (error) {
    logger.error(`Error creating daily post: ${describeError(error)}`);
    return false;
  }

  logger.info(`Created daily blog post: ${filePath} with ${digests.length} articles`);
  return true;
}

// --------------------------------------------------------------------------
// エントリポイント
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

export interface RunOptions {
  targetDate?: CivilDate;
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

  const bookmarks = deps.selectBookmarks(entries, target);
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

export interface CliArgs {
  date?: CivilDate;
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
    const [flag, inlineValue] = arg.startsWith('--date=') ? arg.split('=', 2) : [arg, undefined];
    if (flag === '--date') {
      const value = inlineValue ?? argv[++index];
      const parsed = value ? parseCivilDate(value) : undefined;
      if (!parsed) throw new AbortRun(`--date は YYYY-MM-DD で指定してください: ${value ?? ''}`);
      args.date = parsed;
      continue;
    }
    throw new AbortRun(`不明な引数: ${arg}`);
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    await run({ targetDate: args.date, dryRun: args.dryRun });
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
