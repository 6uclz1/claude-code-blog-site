/**
 * はてなブックマークのRSSから、対象日のブックマークを取り出す。
 */

import {
  formatCivilDate,
  isSameDate,
  type CivilDate,
} from './date.ts';
import { decodeBody, fetchBytes } from './http.ts';
import { describeError, logger } from './logger.ts';
import { entryDatesJst, HATENA_RSS_URL, parseFeed, type FeedEntry } from './rss.ts';
import { sleep } from './sleep.ts';

export const RSS_URL = HATENA_RSS_URL;
export const RSS_TIMEOUT_MS = 15_000;
// RSS取得のリトライ（はてな側が不調でもその日の記事を落とさないため）
export const RSS_RETRY_COUNT = 3;
export const RSS_RETRY_WAIT_MS = 2_000;

/** ブックマーク1件（RSSエントリから必要な情報だけ取り出したもの） */
export interface Bookmark {
  title: string;
  url: string;
}

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
      const { bytes, contentType } = await fetchBytes(rssUrl, { timeoutMs: RSS_TIMEOUT_MS });
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

/** 対象日を指定したRSSのURL */
export function rssUrlForDate(target: CivilDate, rssUrl: string = RSS_URL): string {
  const url = new URL(rssUrl);
  url.searchParams.set('date', formatCivilDate(target).replace(/-/g, ''));
  return url.toString();
}

/** 同じRSSを何度も取りに行かないよう、URLごとに結果を覚えておく */
export function memoizeFetchEntries(
  fetcher: (rssUrl?: string) => Promise<FeedEntry[]>
): (rssUrl?: string) => Promise<FeedEntry[]> {
  const cache = new Map<string, Promise<FeedEntry[]>>();
  return (rssUrl = RSS_URL) => {
    let entries = cache.get(rssUrl);
    if (!entries) {
      entries = fetcher(rssUrl);
      cache.set(rssUrl, entries);
    }
    return entries;
  };
}
