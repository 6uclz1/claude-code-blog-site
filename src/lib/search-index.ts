/**
 * `/index.json` の組み立て。
 *
 * JavaScript を実行しない読み手（AIエージェントの多くはHTMLを取ってくるだけ）は
 * Pagefind の `/search/` を使えない。この1ファイルを取れば全記事とブックマークを
 * 手元で絞り込めるようにする — /llms.txt がその代わりの経路として案内している。
 *
 * astro:content を読まないので単体テストできる（`src/pages/index.json.ts` が使う）。
 */

import { extractBookmarks, hostOf } from './bookmarks';
import { permalinkToParam, toDescription } from './format';
import { postMarkdownPath } from './post-markdown';

export interface IndexPostInput {
  title: string;
  date: Date;
  updated?: Date;
  permalink: string;
  excerpt?: string;
  /** front matter を除いた本文。ブックマークはここから取り出す */
  body: string;
}

export interface SearchIndexInput {
  site: {
    title: string;
    description: string;
  };
  /** 絶対URLの基点（base込み・末尾スラッシュ付き） */
  baseUrl: string;
  /** 新しい順の記事 */
  posts: IndexPostInput[];
}

export interface IndexBookmark {
  title: string;
  /** ブックマーク先のURL。旧形式でURL行が無い記事だけ欠ける */
  url?: string;
  /** ブックマーク先のホスト名（`www.` なし） */
  host?: string;
  /** 1行要約。地の文が無い記事では欠ける */
  summary?: string;
}

export interface IndexPost {
  /** permalink と同じ暦日（YYYY-MM-DD） */
  date: string;
  title: string;
  /** HTML版のURL */
  url: string;
  /** Markdown版のURL。本文がそのまま返る */
  markdown: string;
  excerpt?: string;
  bookmarks: IndexBookmark[];
}

export interface SearchIndex {
  site: {
    title: string;
    description: string;
    url: string;
    llmsTxt: string;
    /** 人が使う検索の入口（`{query}` を検索語に置き換える） */
    searchUrlTemplate: string;
  };
  postCount: number;
  bookmarkCount: number;
  posts: IndexPost[];
}

/** 一覧に添える excerpt の長さ。旧い記事は数百字あり、全記事分だと効いてくる */
const EXCERPT_MAX_CHARS = 200;

export function buildSearchIndex(input: SearchIndexInput): SearchIndex {
  const absolute = (path: string) =>
    new URL(path.replace(/^\/+/, ''), input.baseUrl).href;

  let bookmarkCount = 0;

  const posts = input.posts.map((post): IndexPost => {
    const bookmarks = extractBookmarks(post.body).map((bookmark) => ({
      title: bookmark.title,
      ...(bookmark.url ? { url: bookmark.url, host: hostOf(bookmark.url) } : {}),
      ...(bookmark.summary ? { summary: bookmark.summary } : {}),
    }));
    bookmarkCount += bookmarks.length;

    return {
      date: post.date.toISOString().slice(0, 10),
      title: post.title,
      url: absolute(`${permalinkToParam(post.permalink)}/`),
      markdown: absolute(postMarkdownPath(post.permalink)),
      ...(post.excerpt
        ? { excerpt: toDescription(post.excerpt, EXCERPT_MAX_CHARS) }
        : {}),
      bookmarks,
    };
  });

  return {
    site: {
      title: input.site.title,
      description: input.site.description,
      url: input.baseUrl,
      llmsTxt: absolute('llms.txt'),
      searchUrlTemplate: `${absolute('search/')}?q={query}`,
    },
    postCount: posts.length,
    bookmarkCount,
    posts,
  };
}
