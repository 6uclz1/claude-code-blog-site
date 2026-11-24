/**
 * Twitter/X のポストから本文を取り出す。
 *
 * x.com はログインしないと本文を返さないため、HTMLを直接取っても
 * r.jina.ai を経由しても「JavaScriptを有効にしてください」しか得られない
 * （実際に過去の記事がその内容で要約されている）。認証なしで本文が取れる
 * 経路は次の3つで、取れる情報がいちばん多い FxTwitter を先に試す。
 *
 *  1. api.fxtwitter.com … FxTwitter（OSS の埋め込み修正サービス）のJSON API。
 *     認証不要で、長文ポスト・引用元・画像の代替テキスト・投票の選択肢に加えて、
 *     oEmbed / syndication では本文が空になる X の「記事」(Articles) まで取れる
 *  2. publish.twitter.com の oEmbed … 公式・認証不要。埋め込み用HTMLから本文を取る
 *  3. cdn.syndication.twimg.com … 埋め込みウィジェットが使う非公式API。
 *     本文・作者・引用ツイートまでJSONで取れるが、仕様変更で壊れうる
 *
 * はてなのRSSはポストのタイトルをURLのまま返すことが多いので、
 * 取得できた本文から見出し用のタイトルも組み立てて返す。
 */

import { load } from 'cheerio';

import { fetchJson } from '../http.ts';
import { describeError, logger } from '../logger.ts';

export const TWITTER_HOSTS = ['twitter.com', 'x.com'];
export const FXTWITTER_ENDPOINT = 'https://api.fxtwitter.com';
export const OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';
export const SYNDICATION_ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result';
export const TWITTER_TIMEOUT_MS = 15_000;

/** 見出しに載せるポスト本文の長さ */
export const TITLE_SNIPPET_MAX_CHARS = 48;
/** 要約に渡す X の記事(Articles)本文の上限。要約側でも切るが、無駄に組み立てない */
export const ARTICLE_BODY_MAX_CHARS = 6000;

/** 取得できたポスト1件 */
export interface Tweet {
  id: string;
  /** 表示名（取れないことがある） */
  name?: string;
  handle?: string;
  text: string;
  /** 引用元のポスト（あれば） */
  quoted?: { name?: string; handle?: string; text: string };
  /** X の記事(Articles)。ポスト本文はリンクだけで、中身はこちらにある */
  article?: { title?: string; text: string };
  /** 画像の代替テキストや投票の選択肢など、本文の外にある補足 */
  extras?: string[];
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
// FxTwitter
// --------------------------------------------------------------------------

interface FxAuthor {
  name?: string;
  screen_name?: string;
}

interface FxArticleBlock {
  text?: string;
}

interface FxTweet {
  text?: string;
  author?: FxAuthor;
  quote?: FxTweet;
  media?: { photos?: { altText?: string }[]; all?: { altText?: string }[] };
  poll?: { choices?: { label?: string }[] };
  article?: {
    title?: string;
    preview_text?: string;
    content?: { blocks?: FxArticleBlock[] };
  };
}

interface FxResponse {
  code?: number;
  tweet?: FxTweet;
}

/** FxTwitter の API URL。アカウント名は無視されるので、分からなければ `i` を置く */
export function fxTwitterUrl(ref: TweetRef): string {
  return `${FXTWITTER_ENDPOINT}/${ref.handle ?? 'i'}/status/${ref.id}`;
}

const trimmed = (value: string | undefined) => value?.trim() ?? '';

/** X の記事(Articles)の本文。ブロックを段落としてつなぐ */
export function fxArticle(article: FxTweet['article']): Tweet['article'] | undefined {
  if (!article) return undefined;
  const blocks = (article.content?.blocks ?? []).map((block) => trimmed(block.text)).filter(Boolean);
  const text = (blocks.length > 0 ? blocks.join('\n') : trimmed(article.preview_text)).slice(
    0,
    ARTICLE_BODY_MAX_CHARS
  );
  const title = trimmed(article.title);
  if (!text && !title) return undefined;
  return title ? { title, text } : { text };
}

/** 画像の代替テキストと投票の選択肢。本文が短いポストでは要約の手がかりになる */
export function fxExtras(tweet: FxTweet): string[] {
  const extras: string[] = [];
  const media = tweet.media?.photos ?? tweet.media?.all ?? [];
  for (const item of media) {
    const alt = trimmed(item.altText);
    if (alt) extras.push(`画像: ${alt}`);
  }
  const choices = (tweet.poll?.choices ?? []).map((choice) => trimmed(choice.label)).filter(Boolean);
  if (choices.length > 0) extras.push(`投票: ${choices.join(' / ')}`);
  return extras;
}

export async function fetchTweetViaFxTwitter(ref: TweetRef): Promise<Tweet | undefined> {
  const payload = await fetchJson<FxResponse>(fxTwitterUrl(ref), {
    headers: { Accept: 'application/json' },
    timeoutMs: TWITTER_TIMEOUT_MS,
    retries: 1,
  });
  const source = payload?.tweet;
  if (!source) return undefined;

  const text = trimmed(source.text);
  const article = fxArticle(source.article);
  // 記事(Articles)はポスト本文がリンクだけで空になることがある
  if (!text && !article) return undefined;

  const tweet: Tweet = { id: ref.id, text };
  const name = source.author?.name;
  const handle = source.author?.screen_name ?? ref.handle;
  if (name) tweet.name = name;
  if (handle) tweet.handle = handle;
  if (article) tweet.article = article;

  const quotedText = trimmed(source.quote?.text) || trimmed(source.quote?.article?.title);
  if (quotedText) {
    const quoted: NonNullable<Tweet['quoted']> = { text: quotedText };
    if (source.quote?.author?.name) quoted.name = source.quote.author.name;
    if (source.quote?.author?.screen_name) quoted.handle = source.quote.author.screen_name;
    tweet.quoted = quoted;
  }

  const extras = fxExtras(source);
  if (extras.length > 0) tweet.extras = extras;
  return tweet;
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
  fxTwitter: (ref: TweetRef) => Promise<Tweet | undefined>;
  oEmbed: (ref: TweetRef) => Promise<Tweet | undefined>;
  syndication: (ref: TweetRef) => Promise<Tweet | undefined>;
}

const defaultFetchers: TweetFetchers = {
  fxTwitter: fetchTweetViaFxTwitter,
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
  // 記事(Articles)はポスト本文がリンクだけなので、記事のタイトルを見出しにする
  if (tweet.article?.title) return `${author} の記事: ${tweet.article.title}`;
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
  if (tweet.text) lines.push(tweet.text);

  if (tweet.article) {
    if (tweet.article.title) lines.push(`記事タイトル: ${tweet.article.title}`);
    if (tweet.article.text) lines.push(tweet.article.text);
  }

  if (tweet.quoted) {
    const quotedAuthor = authorLabel(tweet.quoted);
    lines.push(`引用元${quotedAuthor ? `(${quotedAuthor})` : ''}: ${tweet.quoted.text}`);
  }

  lines.push(...(tweet.extras ?? []));

  return lines.join('\n');
}

/**
 * ポストを取得する。取れなければ undefined。
 *
 * 取れる情報がいちばん多い FxTwitter を先に試す。FxTwitter が落ちているときは、
 * アカウント名が分かれば公式の oEmbed を、分からないとき（`/i/web/status/...`）は
 * oEmbed が受け付けないので syndication を次に試す。
 */
export async function fetchTweet(
  ref: TweetRef,
  fetchers: TweetFetchers = defaultFetchers
): Promise<Tweet | undefined> {
  const order: (keyof TweetFetchers)[] = ref.handle
    ? ['fxTwitter', 'oEmbed', 'syndication']
    : ['fxTwitter', 'syndication', 'oEmbed'];

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
