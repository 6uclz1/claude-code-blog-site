/**
 * SNS 共有時の説明文（og:description / twitter:description）を組み立てる。
 *
 * Slack に記事が流れるときは、RSS 連携が出す entry の本文と、リンクを展開した
 * ときの OGP の説明文が両方並ぶ。同じ内容が二重に出て読みにくかったため、
 * feed.xml からは summary を出さず（src/pages/feed.xml.ts）、記事の中身は
 * この OGP の説明文だけで伝える。
 *
 * 出力はブックマーク1件につき「・タイトル」＋その下に1行要約:
 *
 *     ・記事タイトル
 *     　1行要約
 *
 * 要約は「読むかどうか」の判断に効くので入れるが、本文の箇条書きまでは入れない。
 * プレビューが長くなるほど表示側（Slack など）が末尾を切る危険が上がり、
 * そのとき消えるのは後半のブックマーク**丸ごと**だからで、一覧性の方を優先する。
 * 同じ理由で、全体が上限に収まらないときは要約を落として**全件のタイトル**を残す
 * （buildBookmarkLines を参照）。
 */

import type { BookmarkRef } from './bookmarks';
import { extractBookmarks } from './bookmarks';

/** meta タグが際限なく伸びないための保険。超える分は「ほかN件」にまとめる */
export const SHARE_DESCRIPTION_MAX_CHARS = 1500;
/** 1件のタイトルがこれを超えたら省略する（1行に収めて一覧の見通しを保つ） */
export const SHARE_TITLE_MAX_CHARS = 64;
/** 1件の要約がこれを超えたら省略する */
export const SHARE_SUMMARY_MAX_CHARS = 100;

const BULLET = '・';
/** 要約行のぶら下げインデント（全角空白。タイトルとの親子関係を出す） */
const INDENT = '　';

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** 行を改行で連結したときの長さ */
const totalLength = (lines: string[]) =>
  lines.reduce((total, line) => total + line.length + 1, 0);

/**
 * タイトルだけの一覧。文字数の上限に収まらない分は末尾の「ほかN件」にまとめる。
 */
function titleLines(
  bookmarks: BookmarkRef[],
  maxChars: number,
  titleMaxChars: number
): string[] {
  const lines: string[] = [];
  let used = 0;

  for (const bookmark of bookmarks) {
    const line = BULLET + shorten(bookmark.title, titleMaxChars);
    const rest = bookmarks.length - lines.length;
    // 残りを「ほかN件」に畳んだときの長さ。これを足しても収まる場合だけ1行増やす
    const tail = rest > 1 ? `ほか${rest - 1}件`.length + 1 : 0;
    if (lines.length > 0 && used + line.length + 1 + tail > maxChars) break;

    lines.push(line);
    used += line.length + 1;
  }

  const remaining = bookmarks.length - lines.length;
  if (remaining > 0) lines.push(`ほか${remaining}件`);

  return lines;
}

/** タイトルの下に要約をぶら下げた一覧（上限は見ない） */
function linesWithSummaries(
  bookmarks: BookmarkRef[],
  titleMaxChars: number,
  summaryMaxChars: number
): string[] {
  return bookmarks.flatMap((bookmark) => {
    const lines = [BULLET + shorten(bookmark.title, titleMaxChars)];
    const summary = collapse(bookmark.summary ?? '');
    if (summary) lines.push(INDENT + shorten(summary, summaryMaxChars));
    return lines;
  });
}

/**
 * ブックマーク一覧を説明文の行に整形する。
 *
 * 要約付きが上限に収まればそれを、収まらなければ要約を落としてタイトルだけを返す。
 * 「全件のタイトルが見える」ことを優先し、一部だけ要約が付く不揃いな見た目も避ける。
 */
export function buildBookmarkLines(
  bookmarks: BookmarkRef[],
  maxChars = SHARE_DESCRIPTION_MAX_CHARS,
  titleMaxChars = SHARE_TITLE_MAX_CHARS,
  summaryMaxChars = SHARE_SUMMARY_MAX_CHARS
): string[] {
  const detailed = linesWithSummaries(bookmarks, titleMaxChars, summaryMaxChars);
  if (detailed.length && totalLength(detailed) <= maxChars) return detailed;

  return titleLines(bookmarks, maxChars, titleMaxChars);
}

/**
 * 共有用の説明文の行を返す。
 * ブックマーク記事でなければ excerpt をそのまま1行として使う。
 */
export function shareDescriptionLines(body: string, excerpt?: string): string[] {
  const bookmarks = extractBookmarks(body);
  if (bookmarks.length > 0) return buildBookmarkLines(bookmarks);

  const fallback = collapse(excerpt ?? '');
  return fallback ? [fallback] : [];
}

/**
 * 共有用の説明文。Slack のリンク展開は改行をそのまま表示するので、
 * 1件1行の箇条書きにして読めるようにする。
 * 中身が無ければ undefined を返し、呼び出し側の既定の説明文に任せる。
 */
export function shareDescription(body: string, excerpt?: string): string | undefined {
  const lines = shareDescriptionLines(body, excerpt);
  return lines.length ? lines.join('\n') : undefined;
}
