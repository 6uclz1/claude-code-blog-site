/**
 * 自動化スクリプトからの HTTP 取得。
 *
 * ここに集約しているのは次の4点:
 *  - タイムアウト（取得先が応答しないとジョブがそのままハングする）
 *  - リトライ（429/5xx は少し待てば通ることが多い。Retry-After があれば従う）
 *  - 読み込みサイズの上限（本文は先頭数千文字しか使わないので、巨大なファイルを
 *    最後まで読んでメモリを食う理由がない）
 *  - 文字コードの推定
 */

import { logger } from './logger.ts';

// 実在するブラウザに近いUAを名乗る。極端に古いUAはボット判定で弾かれやすい
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Accept を送らないと HTML 以外を返すサイトがあり、Accept-Language が無いと
// 日本語ページで英語版に振り分けられることがある
export const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7';
export const DEFAULT_ACCEPT_LANGUAGE = 'ja,en-US;q=0.9,en;q=0.8';

/** 1リクエストで読み込む上限。本文抽出には十分すぎる大きさ */
export const MAX_BODY_BYTES = 2_000_000;

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  /** 追加の試行回数（0 なら1回だけ試す） */
  retries?: number;
  /** リトライの初回待ち時間。2回目以降は倍にする */
  retryWaitMs?: number;
  maxBytes?: number;
  /** テストから待ち時間を潰すために差し替える */
  wait?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_WAIT_MS = 1_000;

/** HTTP ステータスが 2xx でないときに投げる */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    /** `Retry-After` ヘッダから読んだ待ち時間 */
    readonly retryAfterMs?: number
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }

  /** 待てば通る見込みがあるステータスか（404 などは何度試しても同じ） */
  get retryable(): boolean {
    return this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After`（秒数 or 日時）をミリ秒にする */
function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;

  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, date.getTime() - Date.now());
}

/**
 * レスポンスボディを最大 `maxBytes` まで読む。
 *
 * 上限に達したらそこで打ち切る（本文抽出は先頭しか使わないため、切れても困らない）。
 */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.length;
  }

  if (total >= maxBytes) {
    logger.info(`Response body truncated at ${maxBytes} bytes: ${response.url || '(unknown url)'}`);
    await reader.cancel().catch(() => undefined);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body.length > maxBytes ? body.slice(0, maxBytes) : body;
}

async function request(url: string, options: FetchOptions): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: DEFAULT_ACCEPT,
      'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs),
    redirect: 'follow',
  });
  if (!response.ok) {
    // 読まずに捨てるとソケットが残るため、ここでボディを流し切る
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(response.status, url, retryAfterMs(response));
  }
  return response;
}

/** 生のバイト列を取得する（文字コードを自分で判定したいとき用） */
export async function fetchBytes(
  url: string,
  options: FetchOptions
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const retries = options.retries ?? 0;
  const baseWait = options.retryWaitMs ?? DEFAULT_RETRY_WAIT_MS;
  const wait = options.wait ?? sleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await request(url, options);
      return {
        bytes: await readBody(response, options.maxBytes ?? MAX_BODY_BYTES),
        contentType: response.headers.get('content-type') ?? '',
      };
    } catch (error) {
      // 待てば変わるのは 429/5xx だけ。404・403 は何度試しても同じで、
      // 接続エラーやタイムアウトも同じ相手に投げ直すより次の取得経路に移った方が早い
      const retryable = error instanceof HttpError && error.retryable;
      if (attempt >= retries || !retryable) throw error;

      const suggested = error instanceof HttpError ? error.retryAfterMs : undefined;
      const waitMs = Math.min(suggested ?? baseWait * 2 ** attempt, 30_000);
      logger.info(`Retrying ${url} in ${waitMs}ms (attempt ${attempt + 2}/${retries + 1})`);
      await wait(waitMs);
    }
  }
}

/** テキストとして取得する（`Content-Type` の charset に従う） */
export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url, options);
  return decodeBody(bytes, contentType);
}

/** JSON として取得する。読めなければ undefined */
export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T | undefined> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * テキストとして読める Content-Type か。
 *
 * PDF・画像・動画を cheerio に渡してもゴミしか出ないので、本文抽出の前に弾く。
 * Content-Type が無いサイトもあるため、不明なときは読めるものとして扱う。
 */
export function isTextLike(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!type) return true;
  if (type.startsWith('text/')) return true;
  return /^application\/(xhtml\+xml|xml|json|[\w.-]+\+(?:xml|json))$/.test(type);
}

const CHARSET_IN_HEADER = /charset=["']?([\w-]+)/i;
// <meta charset="shift_jis"> と <meta http-equiv="Content-Type" content="...charset=...">
const CHARSET_IN_META = /<meta[^>]+charset=["']?([\w-]+)/i;

/**
 * バイト列を文字列にする。
 *
 * `Response.text()` は仕様上つねに UTF-8 として解釈するため、Shift_JIS や
 * EUC-JP のページが文字化けする。ヘッダと `<meta charset>` を見て解釈し直す。
 */
export function decodeBody(bytes: Uint8Array, contentType = ''): string {
  const fromHeader = CHARSET_IN_HEADER.exec(contentType)?.[1];
  if (fromHeader && !isUtf8Label(fromHeader)) {
    const decoded = tryDecode(bytes, fromHeader);
    if (decoded !== undefined) return decoded;
  }

  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (fromHeader) return utf8;

  // ヘッダに charset が無いときだけ HTML 側の宣言を見る（先頭のみで足りる）
  const fromMeta = CHARSET_IN_META.exec(utf8.slice(0, 2048))?.[1];
  if (fromMeta && !isUtf8Label(fromMeta)) {
    const decoded = tryDecode(bytes, fromMeta);
    if (decoded !== undefined) return decoded;
  }
  return utf8;
}

const isUtf8Label = (label: string) => /^utf-?8$/i.test(label.trim());

function tryDecode(bytes: Uint8Array, label: string): string | undefined {
  try {
    return new TextDecoder(label.trim()).decode(bytes);
  } catch {
    // Node が知らない charset 名。UTF-8 として読むしかない
    return undefined;
  }
}
