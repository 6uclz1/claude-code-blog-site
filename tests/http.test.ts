import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ACCEPT_LANGUAGE,
  HttpError,
  decodeBody,
  fetchBytes,
  fetchJson,
  isTextLike,
} from '../scripts/lib/http.ts';
import { okResponse } from './helpers.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noWait = async () => {};
const errorResponse = (status: number, headers: Record<string, string> = {}) =>
  new Response('error', { status, headers });

describe('fetchBytes', () => {
  it('ブラウザらしい既定ヘッダとタイムアウトを付ける', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('body'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchBytes('https://example.com/', { timeoutMs: 1000 });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers['Accept-Language']).toBe(DEFAULT_ACCEPT_LANGUAGE);
    expect(init.headers['User-Agent']).toContain('Chrome');
    // 取得先が応答しないとジョブがハングするため、必ずタイムアウトを付ける
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('2xx でなければ HttpError を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404)));

    await expect(fetchBytes('https://example.com/', { timeoutMs: 1000 })).rejects.toThrow(HttpError);
  });

  it('429 はリトライする', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('body'));
    vi.stubGlobal('fetch', fetchMock);

    const { bytes } = await fetchBytes('https://example.com/', {
      timeoutMs: 1000,
      retries: 1,
      wait: noWait,
    });

    expect(new TextDecoder().decode(bytes)).toBe('body');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404 は待っても変わらないのでリトライしない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchBytes('https://example.com/', { timeoutMs: 1000, retries: 2, wait: noWait })
    ).rejects.toThrow(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Retry-After があれば待ち時間に使う', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(okResponse('body'));
    vi.stubGlobal('fetch', fetchMock);
    const wait = vi.fn().mockResolvedValue(undefined);

    await fetchBytes('https://example.com/', { timeoutMs: 1000, retries: 1, wait });

    expect(wait).toHaveBeenCalledWith(3000);
  });

  it('大きすぎるボディは途中で打ち切る', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('a'.repeat(5000))));

    const { bytes } = await fetchBytes('https://example.com/', {
      timeoutMs: 1000,
      maxBytes: 1000,
    });

    expect(bytes.length).toBe(1000);
  });
});

describe('fetchJson', () => {
  it('JSONを読む', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"a":1}', 'application/json')));

    expect(await fetchJson('https://example.com/', { timeoutMs: 1000 })).toEqual({ a: 1 });
  });

  it('JSONでなければ undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('<html>', 'text/html')));

    expect(await fetchJson('https://example.com/', { timeoutMs: 1000 })).toBeUndefined();
  });
});

describe('isTextLike', () => {
  it('テキストとして読めるものだけ true', () => {
    for (const type of ['text/html; charset=utf-8', 'text/plain', 'application/xhtml+xml', '']) {
      expect(isTextLike(type), type).toBe(true);
    }
    for (const type of ['application/pdf', 'image/png', 'video/mp4', 'application/octet-stream']) {
      expect(isTextLike(type), type).toBe(false);
    }
  });
});

describe('decodeBody', () => {
  it('ヘッダの charset に従う', () => {
    const bytes = new Uint8Array(Buffer.from('日本語', 'utf16le'));

    expect(decodeBody(bytes, 'text/html; charset=utf-16le')).toBe('日本語');
  });

  it('ヘッダが無ければ meta charset を見る', () => {
    // EUC-JP の「本文」。UTF-8 として読むと文字化けする
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from('<html><head><meta charset="euc-jp"></head><body>', 'ascii'),
        Buffer.from([0xcb, 0xdc, 0xca, 0xb8]),
        Buffer.from('</body></html>', 'ascii'),
      ])
    );

    expect(decodeBody(bytes)).toContain('本文');
  });
});
