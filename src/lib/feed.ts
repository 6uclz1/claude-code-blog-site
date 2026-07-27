/**
 * feed.xml の summary を組み立てる。
 *
 * Slack の RSS 連携は entry の summary の「冒頭」だけを本文として表示し、
 * 長い場合は途中で切り捨てる。前置き（「はてなブックマークで気になった記事を…」）を
 * 先頭に置くと、肝心のブックマーク一覧が切られて見えなくなるため、
 * summary は本文中の見出しから拾ったブックマークのタイトル一覧だけで構成する。
 */

/** Slackのプレビューに収まる範囲。超える分は「ほかN件」にまとめる */
export const FEED_SUMMARY_MAX_CHARS = 280;
/** 1件のタイトルがこれを超えたら省略する（1行に収めて一覧の見通しを保つ） */
export const FEED_SUMMARY_TITLE_MAX_CHARS = 48;

const BULLET = '・';

// ブックマークの見出しだけを拾う。`## 要点` `## 詳細な要約` のような
// 記事内のセクション見出しを拾わないよう、リンク形式か採番形式のみを対象にする。
const HEADING_PATTERNS = [
  // 現在の形式: ## [タイトル](https://example.com/)
  /^##\s+\[(.+)\]\(https?:\/\/[^)]+\)\s*$/,
  // 旧形式: ## 1. タイトル
  /^##\s+\d+\.\s+(.+?)\s*$/,
];

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** 記事本文からブックマークのタイトルを出現順に取り出す */
export function extractBookmarkTitles(body: string): string[] {
  const titles: string[] = [];

  for (const line of body.split('\n')) {
    for (const pattern of HEADING_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      // 強調記法やバッククォートは一覧では読みにくいので落とす
      const title = collapse(match[1]!.replace(/[*_`]/g, ''));
      if (title) titles.push(title);
      break;
    }
  }

  return titles;
}

function shorten(title: string, limit: number): string {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

/**
 * ブックマーク一覧を summary 用の行に整形する。
 * 文字数の上限に収まらない分は末尾の「ほかN件」にまとめる。
 */
export function buildBookmarkLines(
  titles: string[],
  maxChars = FEED_SUMMARY_MAX_CHARS,
  titleMaxChars = FEED_SUMMARY_TITLE_MAX_CHARS
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
 * feed の summary 本文（プレーンテキストの行）を返す。
 * ブックマーク記事でなければ excerpt をそのまま1行として使う。
 */
export function feedSummaryLines(body: string, excerpt?: string): string[] {
  const titles = extractBookmarkTitles(body);
  if (titles.length > 0) return buildBookmarkLines(titles);

  const fallback = collapse(excerpt ?? '');
  return fallback ? [fallback] : [];
}
