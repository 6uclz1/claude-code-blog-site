import { getCollection, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';
import { permalinkToParam } from './format';

export type Post = CollectionEntry<'posts'>;

// 純粋な整形処理は format.ts にある（astro:content を読まないので単体テストできる）。
// 既存の import 元を変えずに済むよう、ここから再エクスポートする。
export { formatDateJa, permalinkToParam, toDescription, yearOf } from './format';

/** Jekyll の paginate 設定と同じく1ページあたり10記事 */
export const PAGE_SIZE = 10;

/** 記事を新しい順に取得する（Jekyll の site.posts と同じ並び） */
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
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
 * 記事の更新日時。front matter に `updated` があればそれを使う。
 *
 * フィードの <updated> とサイトマップの <lastmod> に反映されるので、
 * 公開後に記事を直したときは front matter に updated を足す。
 */
export function postUpdated(post: Post): Date {
  return post.data.updated ?? post.data.date;
}

/** excerpt は Markdown で書かれているため HTML に変換して表示する */
export function renderExcerpt(excerpt: string): string {
  return marked.parse(excerpt, { async: false });
}
