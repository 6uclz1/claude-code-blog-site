import type { APIRoute } from 'astro';
import { getSortedPosts } from '../lib/posts';
import { buildSearchIndex } from '../lib/search-index';
import { SITE } from '../site';

// 全記事とブックマークを1ファイルにまとめた機械可読なインデックス。
// JavaScript を実行しない読み手が /search/ の代わりに使う（/llms.txt が案内している）。
// 中身の組み立ては src/lib/search-index.ts にある（テストできるようにするため）。

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('astro.config.mjs の site が設定されていません');

  // base（/claude-code-blog-site）を含めた絶対URLの基点
  const baseUrl = new URL(
    `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`,
    site
  );
  const posts = await getSortedPosts();

  const index = buildSearchIndex({
    site: { title: SITE.title, description: SITE.description },
    baseUrl: baseUrl.href,
    posts: posts.map((post) => ({
      title: post.data.title,
      date: post.data.date,
      updated: post.data.updated,
      permalink: post.data.permalink,
      excerpt: post.data.excerpt,
      body: post.body ?? '',
    })),
  });

  // 読むのは機械なので整形しない（全記事分あるとインデントだけで無視できない量になる）
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
