import type { APIRoute, GetStaticPaths } from 'astro';
import { getSortedPosts, permalinkToParam, postUrl, type Post } from '../lib/posts';
import { renderPostMarkdown } from '../lib/post-markdown';

// 記事の Markdown 版。`/2026/07/31/hatena-bookmarks/` に対して
// `/2026/07/31/hatena-bookmarks.md` を出す（`src/lib/post-markdown.ts` の
// postMarkdownPath と同じ規則）。HTML を解析できない読み手のための出口で、
// /llms.txt がこの規則を案内している。
//
// permalink の重複検査は同じ組み合わせを使う [...slug].astro が行う。

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getSortedPosts();
  return posts.map((post) => ({
    params: { slug: permalinkToParam(post.data.permalink) },
    props: { post },
  }));
};

export const GET: APIRoute = ({ props, site }) => {
  const post = props.post as Post;
  const url = site ? new URL(postUrl(post), site).href : postUrl(post);

  const body = renderPostMarkdown({
    title: post.data.title,
    date: post.data.date,
    updated: post.data.updated,
    permalink: post.data.permalink,
    excerpt: post.data.excerpt,
    body: post.body ?? '',
    url,
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
