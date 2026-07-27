/**
 * まとめ記事の本文から、ブックマーク1件ずつの見出しを取り出す。
 *
 * フィードの summary（src/lib/feed.ts）と、ブックマーク先サイトの集計ページ
 * （src/pages/sites.astro）が同じ抽出結果を使う。front matter の excerpt は
 * 生成時期によって書式が違うため、常に本文から拾う方が揃う。
 */

export interface BookmarkRef {
  title: string;
  /** 旧形式（`## 1. タイトル`）にはURLが無いため任意 */
  url?: string;
}

// 記事内の `## 要点` `## 詳細な要約` のようなセクション見出しを拾わないよう、
// リンク形式か採番形式のみを対象にする。
const HEADING_PATTERNS: { pattern: RegExp; hasUrl: boolean }[] = [
  // 現在の形式: ## [タイトル](https://example.com/)
  { pattern: /^##\s+\[(.+)\]\((https?:\/\/[^)]+)\)\s*$/, hasUrl: true },
  // 旧形式: ## 1. タイトル
  { pattern: /^##\s+\d+\.\s+(.+?)\s*$/, hasUrl: false },
];

// 旧形式は見出しにURLを持たず、直後の本文に `**URL:** [...](...)` の行を置いている。
// 既存記事はすべてこの形式なので、見出しの後に続くこの行からURLを補う。
const URL_LINE_PATTERN = /^\*\*URL:\*\*\s*\[[^\]]*\]\((https?:\/\/[^)]+)\)/;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** 強調記法やバッククォートは一覧では読みにくいので落とす */
const cleanTitle = (raw: string) => collapse(raw.replace(/[*_`]/g, ''));

/** 記事本文からブックマークを出現順に取り出す */
export function extractBookmarks(body: string): BookmarkRef[] {
  const bookmarks: BookmarkRef[] = [];
  // 直近の見出し。URL行が来たらここに書き込む
  let pending: BookmarkRef | undefined;

  for (const line of body.split('\n')) {
    let matchedHeading = false;

    for (const { pattern, hasUrl } of HEADING_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      matchedHeading = true;

      const title = cleanTitle(match[1]!);
      if (title) {
        const bookmark: BookmarkRef = hasUrl
          ? { title, url: match[2] }
          : { title };
        bookmarks.push(bookmark);
        pending = bookmark;
      } else {
        pending = undefined;
      }
      break;
    }
    if (matchedHeading) continue;

    if (pending && !pending.url) {
      const urlMatch = URL_LINE_PATTERN.exec(line);
      if (urlMatch) pending.url = urlMatch[1];
    }
  }

  return bookmarks;
}

/** 記事本文からブックマークのタイトルだけを出現順に取り出す */
export function extractBookmarkTitles(body: string): string[] {
  return extractBookmarks(body).map((bookmark) => bookmark.title);
}

/**
 * URLのホスト名（`www.` は落として小文字）。URLとして読めなければ undefined。
 * ブックマーク先サイトの集計キーに使う。
 */
export function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}
