/**
 * 記事HTMLから本文らしいテキストを取り出す。
 *
 * 取得先はまちまちなので、代表的なコンテナを順に試し、どれも無ければ body 全体を使う。
 */

import { load } from 'cheerio';

/** 取得できた本文1件。取得経路によってはタイトルも分かる（Twitter/X など） */
export interface ArticleContent {
  text: string;
  /** はてなのRSSのタイトルが使えないときの差し替え用 */
  title?: string;
  /** どの経路で取れたか（ログ用） */
  source: string;
}

/** 本文が入っていそうな要素を優先順に試す */
export const CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  '.entry-content',
  '.post-content',
  '.article-body',
  '.content',
  'main',
  '.main-content',
] as const;

/** 本文ではないので落とす要素 */
const NOISE_SELECTOR = 'script, style, nav, header, footer, aside';

/** DOM ノードのうち、テキスト抽出に必要な部分だけを見た構造型 */
interface TextNode {
  type: string;
  data?: string;
  children?: TextNode[];
}

/**
 * 要素配下のテキストを集める。
 *
 * ブロック要素をまたぐ語が連結しないよう、テキストノードごとに区切って空白で繋ぐ。
 */
function collectText(node: TextNode, parts: string[]): void {
  if (node.type === 'text') {
    const text = (node.data ?? '').trim();
    if (text) parts.push(text);
    return;
  }
  for (const child of node.children ?? []) collectText(child, parts);
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * HTML から本文テキストを取り出す。`limit` 文字で打ち切る。
 * 本文が取れなければ undefined。
 */
export function extractArticleText(html: string, limit: number): string | undefined {
  const $ = load(html);
  $(NOISE_SELECTOR).remove();

  let text = '';
  for (const selector of CONTENT_SELECTORS) {
    const element = $(selector).first();
    if (element.length === 0) continue;
    const parts: string[] = [];
    collectText(element.get(0) as unknown as TextNode, parts);
    text = parts.join(' ');
    break;
  }

  if (!text) {
    const body = $('body').get(0);
    if (body) {
      const parts: string[] = [];
      collectText(body as unknown as TextNode, parts);
      text = parts.join(' ');
    }
  }

  const normalized = collapse(text);
  return normalized ? normalized.slice(0, limit) : undefined;
}
