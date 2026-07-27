import { getCollection, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';

export type Post = CollectionEntry<'posts'>;

/** Jekyll の paginate 設定と同じく1ページあたり10記事 */
export const PAGE_SIZE = 10;

/** 記事を新しい順に取得する（Jekyll の site.posts と同じ並び） */
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/**
 * permalink から Astro のルートパラメータを作る。
 * `/2026/07/26/hatena-bookmarks/` -> `2026/07/26/hatena-bookmarks`
 */
export function permalinkToParam(permalink: string): string {
  return permalink.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** base（/claude-code-blog-site）を付けたサイト内URLを作る */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/** ページ送りのURL。Jekyll の paginate_path: "/page:num/" と同じ（1ページ目は "/"） */
export function pagePath(num: number): string {
  return withBase(num === 1 ? '/' : `/page${num}/`);
}

/** 記事の公開URL（baseurl込み・末尾スラッシュ付き） */
export function postUrl(post: Post): string {
  return withBase(`${permalinkToParam(post.data.permalink)}/`);
}

/**
 * 日本語表記の日付（例: 2026年07月26日）
 *
 * Jekyll と同じく UTC で表示する。記事の date は翌朝JSTの配信時刻なので、
 * UTCで表示するとブックマーク日（= permalink の日付）と一致する。
 */
export function formatDateJa(date: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}年${get('month')}月${get('day')}日`;
}

/** excerpt は Markdown で書かれているため HTML に変換して表示する */
export function renderExcerpt(excerpt: string): string {
  return marked.parse(excerpt, { async: false });
}

/** meta description 用にHTMLタグと改行を落として切り詰める */
export function toDescription(text: string, length = 160): string {
  const plain = text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length)}...` : plain;
}
