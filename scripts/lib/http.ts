/**
 * 自動化スクリプトからの HTTP 取得。
 *
 * タイムアウトを必ず付ける（はてなや取得先が応答しないとジョブがそのまま
 * ハングするため）ことと、文字コードの推定をここに集約している。
 */

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
}

/** HTTP ステータスが 2xx でないときに投げる */
export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

async function request(url: string, options: FetchOptions): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs),
    redirect: 'follow',
  });
  if (!response.ok) throw new HttpError(response.status, url);
  return response;
}

/** 生のバイト列を取得する（文字コードを自分で判定したいとき用） */
export async function fetchBytes(
  url: string,
  options: FetchOptions
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await request(url, options);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
}

/** テキストとして取得する（`Content-Type` の charset に従う） */
export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url, options);
  return decodeBody(bytes, contentType);
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
