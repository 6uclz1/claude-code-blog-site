import type { APIRoute } from 'astro';
import { getSortedPosts, permalinkToParam } from '../lib/posts';
import { LLMS_RECENT_LIMIT, renderLlmsTxt } from '../lib/llms';
import { postMarkdownPath } from '../lib/post-markdown';
import { SITE } from '../site';

// AIエージェント向けの入口（https://llmstxt.org/）。
// 中身の組み立ては src/lib/llms.ts にある（テストできるようにするため）。

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('astro.config.mjs の site が設定されていません');

  // base（/claude-code-blog-site）を含めた絶対URLの基点
  const baseUrl = new URL(
    `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`,
    site
  );
  const absolute = (path: string) => new URL(path.replace(/^\/+/, ''), baseUrl).href;

  const posts = await getSortedPosts();

  const body = renderLlmsTxt({
    title: SITE.title,
    description: SITE.description,
    urls: {
      home: baseUrl.href,
      search: absolute('search/'),
      archive: absolute('archive/'),
      sites: absolute('sites/'),
      feed: absolute('feed.xml'),
    },
    postCount: posts.length,
    recent: posts.slice(0, LLMS_RECENT_LIMIT).map((post) => ({
      title: post.data.title,
      url: absolute(`${permalinkToParam(post.data.permalink)}/`),
      markdownUrl: absolute(postMarkdownPath(post.data.permalink)),
      date: post.data.date,
      excerpt: post.data.excerpt,
    })),
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
