/**
 * Twitter/X のポストから本文を取り出す。
 *
 * x.com はログインしないと本文を返さないため、HTMLを直接取っても
 * r.jina.ai を経由しても「JavaScriptを有効にしてください」しか得られない
 * （実際に過去の記事がその内容で要約されている）。認証なしで本文が取れる
 * 経路は次の2つで、公式で安定している oEmbed を先に試す。
 *
 *  1. publish.twitter.com の oEmbed … 公式・認証不要。埋め込み用HTMLから本文を取る
 *  2. cdn.syndication.twimg.com … 埋め込みウィジェットが使う非公式API。
 *     本文・作者・引用ツイートまでJSONで取れるが、仕様変更で壊れうる
 *
 * はてなのRSSはポストのタイトルをURLのまま返すことが多いので、
 * 取得できた本文から見出し用のタイトルも組み立てて返す。
 */

import { load } from 'cheerio';

import { fetchJson } from '../http.ts';
import { describeError, logger } from '../logger.ts';

export const TWITTER_HOSTS = ['twitter.com', 'x.com'];
export const OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';
export const SYNDICATION_ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result';
export const TWITTER_TIMEOUT_MS = 15_000;

/** 見出しに載せるポスト本文の長さ */
export const TITLE_SNIPPET_MAX_CHARS = 48;

/** 取得できたポスト1件 */
export interface Tweet {
  id: string;
  /** 表示名（取れないことがある） */
  name?: string;
  handle?: string;
  text: string;
  /** 引用元のポスト（あれば） */
  quoted?: { name?: string; handle?: string; text: string };
}

/** URLから取り出したポストの参照 */
export interface TweetRef {
  id: string;
  handle?: string;
}

/** ホスト名（`www.` と `mobile.` は落として小文字） */
function hostOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.replace(/^(?:www|mobile|m)\./, '');
}

/** Twitter/X のURLか */
export function isTwitterUrl(url: URL): boolean {
  const host = hostOf(url);
  return TWITTER_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

const STATUS_WITH_HANDLE = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/;
const STATUS_WITHOUT_HANDLE = /^\/i\/(?:web\/)?status(?:es)?\/(\d{1,25})/;

/**
 * ポストのURLから ID とアカウントを取り出す。
 *
 * プロフィール（`x.com/handle`）やトレンド（`x.com/i/trending/...`）は
 * 1件のポストではないため undefined を返す。要約する対象が無いので、
 * 呼び出し側はこれを見て取得そのものを諦める。
 */
export function parseTweetRef(rawUrl: string): TweetRef | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!isTwitterUrl(url)) return undefined;

  const withHandle = STATUS_WITH_HANDLE.exec(url.pathname);
  if (withHandle) return { id: withHandle[2]!, handle: withHandle[1]! };

  const withoutHandle = STATUS_WITHOUT_HANDLE.exec(url.pathname);
  if (withoutHandle) return { id: withoutHandle[1]! };

  return undefined;
}

/** oEmbed に渡す正規化したURL（`?s=20` のような余計なクエリを落とす） */
export function canonicalTweetUrl(ref: TweetRef): string {
  return `https://twitter.com/${ref.handle ?? 'i/web'}/status/${ref.id}`;
}

// --------------------------------------------------------------------------
// oEmbed
// --------------------------------------------------------------------------

interface OEmbedResponse {
  html?: string;
  author_name?: string;
  author_url?: string;
}

/** 埋め込み用HTMLから本文と作者を取り出す */
export function parseOEmbedHtml(html: string): { text: string; handle?: string } {
  const $ = load(html);

  // 本文は <blockquote> 内の <p>、その後ろに「— 表示名 (@handle) 日付」が続く
  const paragraphs = $($('blockquote').length > 0 ? 'blockquote p' : 'p')
    .map((_, element) => $(element).text())
    .get();
  const text = paragraphs.join('\n').replace(/[ \t]+/g, ' ').trim();

  const handle = /@([A-Za-z0-9_]{1,15})/.exec($.root().text())?.[1];
  return handle ? { text, handle } : { text };
}

export async function fetchTweetViaOEmbed(ref: TweetRef): Promise<Tweet | undefined> {
  const params = new URLSearchParams({
    url: canonicalTweetUrl(ref),
    omit_script: '1',
    dnt: 'true',
    lang: 'ja',
  });

  const payload = await fetchJson<OEmbedResponse>(`${OEMBED_ENDPOINT}?${params}`, {
    timeoutMs: TWITTER_TIMEOUT_MS,
    retries: 1,
  });
  if (!payload?.html) return undefined;

  const { text, handle } = parseOEmbedHtml(payload.html);
  if (!text) return undefined;

  const tweet: Tweet = { id: ref.id, text };
  if (payload.author_name) tweet.name = payload.author_name;
  const resolved = ref.handle ?? handle;
  if (resolved) tweet.handle = resolved;
  return tweet;
}

// --------------------------------------------------------------------------
// syndication (非公式)
// --------------------------------------------------------------------------

/**
 * syndication API が要求するトークン。ポストIDから決まる値で、認証情報ではない
 * （埋め込みウィジェットが同じ計算をしている）。
 */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e6) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

interface SyndicationUser {
  name?: string;
  screen_name?: string;
}

interface SyndicationTweet {
  text?: string;
  user?: SyndicationUser;
  quoted_tweet?: { text?: string; user?: SyndicationUser };
}

export async function fetchTweetViaSyndication(ref: TweetRef): Promise<Tweet | undefined> {
  const params = new URLSearchParams({
    id: ref.id,
    lang: 'ja',
    token: syndicationToken(ref.id),
  });

  const payload = await fetchJson<SyndicationTweet>(`${SYNDICATION_ENDPOINT}?${params}`, {
    timeoutMs: TWITTER_TIMEOUT_MS,
    retries: 1,
  });
  const text = payload?.text?.trim();
  if (!payload || !text) return undefined;

  const tweet: Tweet = { id: ref.id, text };
  const name = payload.user?.name;
  const handle = payload.user?.screen_name ?? ref.handle;
  if (name) tweet.name = name;
  if (handle) tweet.handle = handle;

  const quotedText = payload.quoted_tweet?.text?.trim();
  if (quotedText) {
    const quoted: NonNullable<Tweet['quoted']> = { text: quotedText };
    const quotedName = payload.quoted_tweet?.user?.name;
    const quotedHandle = payload.quoted_tweet?.user?.screen_name;
    if (quotedName) quoted.name = quotedName;
    if (quotedHandle) quoted.handle = quotedHandle;
    tweet.quoted = quoted;
  }
  return tweet;
}

// --------------------------------------------------------------------------
// 組み立て
// --------------------------------------------------------------------------

export interface TweetFetchers {
  oEmbed: (ref: TweetRef) => Promise<Tweet | undefined>;
  syndication: (ref: TweetRef) => Promise<Tweet | undefined>;
}

const defaultFetchers: TweetFetchers = {
  oEmbed: fetchTweetViaOEmbed,
  syndication: fetchTweetViaSyndication,
};

/** 「表示名(@handle)」。どちらも無ければ undefined */
export function authorLabel(tweet: Pick<Tweet, 'name' | 'handle'>): string | undefined {
  if (tweet.name && tweet.handle) return `${tweet.name}(@${tweet.handle})`;
  if (tweet.handle) return `@${tweet.handle}`;
  return tweet.name;
}

const stripUrls = (text: string) => text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

/** 見出しに使うタイトル。はてなのRSSがURLしか返さないポスト用 */
export function tweetTitle(tweet: Tweet): string {
  const author = authorLabel(tweet) ?? 'X';
  const snippet = stripUrls(tweet.text);
  if (!snippet) return `${author} のポスト`;
  const shortened =
    snippet.length > TITLE_SNIPPET_MAX_CHARS
      ? `${snippet.slice(0, TITLE_SNIPPET_MAX_CHARS - 1)}…`
      : snippet;
  return `${author} のポスト: ${shortened}`;
}

/** 要約に渡す本文。作者と引用元も添える */
export function tweetText(tweet: Tweet): string {
  const lines: string[] = [];
  const author = authorLabel(tweet);
  if (author) lines.push(`${author} のポスト:`);
  lines.push(tweet.text);

  if (tweet.quoted) {
    const quotedAuthor = authorLabel(tweet.quoted);
    lines.push(`引用元${quotedAuthor ? `(${quotedAuthor})` : ''}: ${tweet.quoted.text}`);
  }

  return lines.join('\n');
}

/**
 * ポストを取得する。取れなければ undefined。
 *
 * アカウント名が分かるときは公式の oEmbed を先に、分からないとき
 * （`/i/web/status/...`）は oEmbed が受け付けないので syndication を先に試す。
 */
export async function fetchTweet(
  ref: TweetRef,
  fetchers: TweetFetchers = defaultFetchers
): Promise<Tweet | undefined> {
  const order: (keyof TweetFetchers)[] = ref.handle
    ? ['oEmbed', 'syndication']
    : ['syndication', 'oEmbed'];

  for (const name of order) {
    try {
      const tweet = await fetchers[name](ref);
      if (tweet) return tweet;
      logger.info(`No tweet body from ${name} for ${ref.id}`);
    } catch (error) {
      logger.warn(`Error fetching tweet ${ref.id} via ${name}: ${describeError(error)}`);
    }
  }

  return undefined;
}
