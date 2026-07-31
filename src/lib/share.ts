/**
 * SNS 共有時の説明文（og:description / twitter:description）を組み立てる。
 *
 * Slack に記事が流れるときは、RSS 連携が出す entry の本文と、リンクを展開した
 * ときの OGP の説明文が両方並ぶ。同じ内容が二重に出て読みにくかったため、
 * feed.xml からは summary を出さず（src/pages/feed.xml.ts）、記事の中身は
 * この OGP の説明文だけで伝える。
 *
 * そのため一覧は「入る分だけ」ではなく、その日のブックマークを全部載せる。
 * 上限（SHARE_DESCRIPTION_MAX_CHARS）は meta タグが無制限に伸びるのを防ぐ
 * 保険で、通常の日次記事（10件前後）では発動しない。
 */

import { extractBookmarkTitles } from './bookmarks';

/** meta タグが際限なく伸びないための保険。超える分は「ほかN件」にまとめる */
export const SHARE_DESCRIPTION_MAX_CHARS = 900;
/** 1件のタイトルがこれを超えたら省略する（1行に収めて一覧の見通しを保つ） */
export const SHARE_TITLE_MAX_CHARS = 64;

const BULLET = '・';

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function shorten(title: string, limit: number): string {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

/**
 * ブックマーク一覧を説明文の行に整形する。
 * 文字数の上限に収まらない分は末尾の「ほかN件」にまとめる。
 */
export function buildBookmarkLines(
  titles: string[],
  maxChars = SHARE_DESCRIPTION_MAX_CHARS,
  titleMaxChars = SHARE_TITLE_MAX_CHARS
): string[] {
  const lines: string[] = [];
  let used = 0;

  for (const title of titles) {
    const line = BULLET + shorten(title, titleMaxChars);
    const rest = titles.length - lines.length;
    // 残りを「ほかN件」に畳んだときの長さ。これを足しても収まる場合だけ1行増やす
    const tail = rest > 1 ? `ほか${rest - 1}件`.length + 1 : 0;
    if (lines.length > 0 && used + line.length + 1 + tail > maxChars) break;

    lines.push(line);
    used += line.length + 1;
  }

  const remaining = titles.length - lines.length;
  if (remaining > 0) lines.push(`ほか${remaining}件`);

  return lines;
}

/**
 * 共有用の説明文の行を返す。
 * ブックマーク記事でなければ excerpt をそのまま1行として使う。
 */
export function shareDescriptionLines(body: string, excerpt?: string): string[] {
  const titles = extractBookmarkTitles(body);
  if (titles.length > 0) return buildBookmarkLines(titles);

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
