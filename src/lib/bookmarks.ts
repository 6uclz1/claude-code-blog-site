/**
 * まとめ記事の本文から、ブックマーク1件ずつの見出しを取り出す。
 *
 * フィードの summary（src/lib/feed.ts）と、ブックマーク先サイトの集計ページ
 * （src/pages/sites.astro）が同じ抽出結果を使う。front matter の excerpt は
 * 生成時期によって書式が違うため、常に本文から拾う方が揃う。
 */

import { displayTitle } from './url';

export interface BookmarkRef {
  title: string;
  /** 旧形式（`## 1. タイトル`）にはURLが無いため任意 */
  url?: string;
}

// リンクの宛先。`<...>` で囲む形（括弧や空白を含むURL）と裸の形の両方を受ける。
// 裸の形は貪欲に読んで行末の `)` までを宛先とし、URLの中の対応の取れた括弧
// （例: `.../wiki/地方病_(日本住血吸虫症)`）が途中で切れないようにする。
const DESTINATION = '(?:<(https?:\\/\\/[^>]+)>|(https?:\\/\\/.+))';

// 記事内の `## 要点` `## 詳細な要約` のようなセクション見出しを拾わないよう、
// リンク形式か採番形式のみを対象にする。
const HEADING_PATTERNS: { pattern: RegExp; hasUrl: boolean }[] = [
  // 現在の形式: ## [タイトル](https://example.com/)
  { pattern: new RegExp(`^##\\s+\\[(.+)\\]\\(${DESTINATION}\\)\\s*$`), hasUrl: true },
  // 旧形式: ## 1. タイトル
  { pattern: /^##\s+\d+\.\s+(.+?)\s*$/, hasUrl: false },
];

// 旧形式は見出しにURLを持たず、直後の本文に `**URL:** [...](...)` の行を置いている。
// 既存記事はすべてこの形式なので、見出しの後に続くこの行からURLを補う。
const URL_LINE_PATTERN = new RegExp(
  `^\\*\\*URL:\\*\\*\\s*\\[[^\\]]*\\]\\(${DESTINATION}\\)\\s*$`
);

/** 正規表現のどちらの宛先グループに入ったかを見て、URLを取り出す */
const destinationOf = (match: RegExpExecArray, first: number) =>
  match[first] ?? match[first + 1];

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * 強調記法やバッククォートは一覧では読みにくいので落とし、
 * タイトルがURLのままのもの（元記事のタイトルが取れなかったブックマーク）は
 * パーセントエンコードを解いて日本語が読めるようにする。
 */
const cleanTitle = (raw: string) =>
  displayTitle(collapse(raw.replace(/[*_`]/g, '').replace(/\\([\\[\]])/g, '$1')));

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
          ? { title, url: destinationOf(match, 2) }
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
      if (urlMatch) pending.url = destinationOf(urlMatch, 1);
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
