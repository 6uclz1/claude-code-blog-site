/**
 * ブックマーク先の記事本文を取得する。
 *
 * URLごとに取得経路の順番を決め（fetchPlan）、ログイン誘導などの定型文や
 * 短すぎる結果を弾きながら上から試す（fetchArticle）。
 */

import { extractArticleText, type ArticleContent } from './article.ts';
import { boilerplateReason } from './boilerplate.ts';
import { decodeBody, fetchBytes, fetchText, isTextLike, USER_AGENT } from './http.ts';
import { describeError, logger } from './logger.ts';
import { fetchTweet, isTwitterUrl, parseTweetRef, tweetText, tweetTitle } from './sources/twitter.ts';

export type { ArticleContent };

// 記事本文の取得まわり
export const HTTP_TIMEOUT_MS = 15_000;
/** 記事取得のリトライ（429/5xx のみ。404 は待っても変わらないので即諦める） */
export const ARTICLE_RETRY_COUNT = 1;
export const ARTICLE_TEXT_LIMIT = 3000;
// 本文として採用する最低文字数。これを下回るときは取得失敗とみなして
// 次の経路を試す（ログイン誘導やCookie同意だけのページ対策）
export const MIN_ARTICLE_TEXT_CHARS = 200;

// r.jina.ai 経由の取得
// JavaScriptでレンダリングされるサイトは HTML を直接取っても本文が無いため、
// レンダリング済みのテキストを返してくれる r.jina.ai を使う。
export const JINA_READER_PREFIX = 'https://r.jina.ai/';
export const JINA_TIMEOUT_MS = 30_000;

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
