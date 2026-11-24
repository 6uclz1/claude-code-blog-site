/**
 * feed.xml の entry に入れる本文（Atom の `<summary type="text">`）を組み立てる。
 *
 * Slack の RSS 連携は、entry の本文をメッセージとして出したうえで、リンクを展開して
 * OGP の説明文もカードとして出す。両方に中身があると同じ一覧が二重に並ぶため、
 * 記事の中身はこのフィード本文だけで伝え、OGP の説明文は excerpt の1文にとどめる
 * （src/layouts/PostLayout.astro）。メッセージ本文の方がカードより長く表示でき、
 * Slack の検索にもかかる。
 *
 * 出力はブックマーク1件につき「・タイトル」＋その下に1行要約とURL。件の間は空行:
 *
 *     ・記事タイトル
 *     　記事の1行要約
 *     　https://example.com/article
 *
 *     ・次の記事タイトル
 *     …
 *
 * 上限（FEED_SUMMARY_MAX_CHARS）に収まらないときは、どのブックマークも落とさない
 * ことを優先して段階的に削る: まずURL行を落とし（リンクは記事ページから辿れる）、
 * それでも収まらなければ要約も落としてタイトルだけにし、最後に残りを「ほかN件」に畳む。
 * 一部だけ詳しくて残りが消えるより、全件が見える方が一覧として役に立つ。
 */

import type { BookmarkRef } from './bookmarks';
import { extractBookmarks } from './bookmarks';

/**
 * フィード本文の上限。今の `_posts/` では URL 付きで 406/435 本、URL を落とせば
 * 426/435 本がこれに収まる。週刊まとめのような件数の多い記事でもフィードが
 * 際限なく太らないための保険。
 */
export const FEED_SUMMARY_MAX_CHARS = 2000;
/** 1件のタイトルがこれを超えたら省略する（1行に収めて一覧の見通しを保つ） */
export const FEED_TITLE_MAX_CHARS = 64;

const BULLET = '・';
/** 要約・URL行のぶら下げインデント（全角空白。タイトルとの親子関係を出す） */
const INDENT = '　';
/** ブックマークの間の区切り（空行） */
const SEPARATOR = '\n\n';

/** どこまで載せるか。上限を超えたら後ろの段階に落とす */
type Detail = 'full' | 'summary' | 'title';
const DETAILS: Detail[] = ['full', 'summary', 'title'];

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** ブックマーク1件分のテキスト（複数行） */
function renderBookmark(
  bookmark: BookmarkRef,
  detail: Detail,
  titleMaxChars: number
): string {
  const lines = [BULLET + shorten(bookmark.title, titleMaxChars)];
  if (detail !== 'title' && bookmark.summary) lines.push(INDENT + bookmark.summary);
  if (detail === 'full' && bookmark.url) lines.push(INDENT + bookmark.url);
  return lines.join('\n');
}

const joinedLength = (blocks: string[]) =>
  blocks.reduce((total, block) => total + block.length, 0) +
  Math.max(0, blocks.length - 1) * SEPARATOR.length;

/** タイトルだけの一覧。収まらない分は末尾の「ほかN件」にまとめる */
function foldTitles(blocks: string[], maxChars: number): string[] {
  const shown: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const rest = blocks.length - index - 1;
    const candidate = [...shown, blocks[index]!];
    const tail = rest > 0 ? [`ほか${rest}件`] : [];
    // 1件目は上限を超えていても出す（空の本文を避ける）
    if (shown.length > 0 && joinedLength([...candidate, ...tail]) > maxChars) break;
    shown.push(blocks[index]!);
  }
  const remaining = blocks.length - shown.length;
  return remaining > 0 ? [...shown, `ほか${remaining}件`] : shown;
}

/**
 * ブックマークの一覧を、上限に収まるいちばん詳しい形で返す。
 * 戻り値はブックマーク1件（または「ほかN件」）ごとのテキスト。
 */
export function buildFeedSummaryBlocks(
  bookmarks: BookmarkRef[],
  maxChars = FEED_SUMMARY_MAX_CHARS,
  titleMaxChars = FEED_TITLE_MAX_CHARS
): string[] {
  for (const detail of DETAILS) {
    const blocks = bookmarks.map((bookmark) =>
      renderBookmark(bookmark, detail, titleMaxChars)
    );
    if (detail === 'title') return foldTitles(blocks, maxChars);
    if (joinedLength(blocks) <= maxChars) return blocks;
  }
  return [];
}

/**
 * フィードの entry 本文。ブックマーク記事でなければ excerpt をそのまま使う
 * （週刊まとめは日次記事で配信済みの一覧を並べ直したものなので、概要の1文で足りる）。
 * 中身が無ければ undefined を返し、呼び出し側は `<summary>` を出さない。
 */
export function feedSummary(body: string, excerpt?: string): string | undefined {
  const bookmarks = extractBookmarks(body);
  if (bookmarks.length > 0) return buildFeedSummaryBlocks(bookmarks).join(SEPARATOR);

  const fallback = collapse(excerpt ?? '');
  return fallback || undefined;
}
