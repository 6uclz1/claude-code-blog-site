/**
 * SNS 共有時の説明文（og:description / twitter:description）を組み立てる。
 *
 * Slack に記事が流れるときは、RSS 連携が出す entry の本文と、リンクを展開した
 * ときの OGP の説明文が両方並ぶ。同じ内容が二重に出て読みにくかったため、
 * feed.xml からは summary を出さず（src/pages/feed.xml.ts）、記事の中身は
 * この OGP の説明文だけで伝える。
 *
 * 出力はブックマーク1件につき「・タイトル」＋その下にURL:
 *
 *     ・記事タイトル
 *     　https://example.com/article
 *
 * Slack などのリンク展開から元記事へ直接移動できるよう、要約ではなくURLを載せる。
 * プレビューが長くなって上限に収まらない場合は、タイトルとURLの組を途中で切らず、
 * 残りを「ほかN件」にまとめる（buildBookmarkLines を参照）。
 */

import type { BookmarkRef } from './bookmarks';
import { extractBookmarks } from './bookmarks';

/** meta タグが際限なく伸びないための保険。超える分は「ほかN件」にまとめる */
export const SHARE_DESCRIPTION_MAX_CHARS = 1500;
/** 1件のタイトルがこれを超えたら省略する（1行に収めて一覧の見通しを保つ） */
export const SHARE_TITLE_MAX_CHARS = 64;
const BULLET = '・';
/** URL行のぶら下げインデント（全角空白。タイトルとの親子関係を出す） */
const INDENT = '　';

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** 行を改行で連結したときの長さ */
const totalLength = (lines: string[]) =>
  lines.reduce((total, line) => total + line.length + 1, 0);

/** タイトルとURLの一覧。収まらない分は末尾の「ほかN件」にまとめる。 */
export function buildBookmarkLines(
  bookmarks: BookmarkRef[],
  maxChars = SHARE_DESCRIPTION_MAX_CHARS,
  titleMaxChars = SHARE_TITLE_MAX_CHARS
): string[] {
  const lines: string[] = [];
  let used = 0;

  for (let index = 0; index < bookmarks.length; index += 1) {
    const bookmark = bookmarks[index]!;
    const entry = [BULLET + shorten(bookmark.title, titleMaxChars)];
    if (bookmark.url) entry.push(INDENT + bookmark.url);

    const rest = bookmarks.length - index - 1;
    // 残りを「ほかN件」に畳む行も含めて上限内なら、この組を追加する。
    const tailLength = rest > 0 ? `ほか${rest}件`.length + 1 : 0;
    const entryLength = totalLength(entry);
    if (lines.length > 0 && used + entryLength + tailLength > maxChars) break;

    lines.push(...entry);
    used += entryLength;
  }

  const shown = lines.filter((line) => line.startsWith(BULLET)).length;
  const remaining = bookmarks.length - shown;
  if (remaining > 0) lines.push(`ほか${remaining}件`);

  return lines;
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
 * 1件をタイトルとURLの2行にして読めるようにする。
 * 中身が無ければ undefined を返し、呼び出し側の既定の説明文に任せる。
 */
export function shareDescription(body: string, excerpt?: string): string | undefined {
  const lines = shareDescriptionLines(body, excerpt);
  return lines.length ? lines.join('\n') : undefined;
}
