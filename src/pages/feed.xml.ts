import type { APIRoute } from 'astro';
import { getSortedPosts, permalinkToParam, type Post } from '../lib/posts';
import { SITE } from '../site';

// jekyll-feed と同じ Atom 形式で出力する。
// 既存の購読者と公開前ゲート(scripts/validate_build.py)がこの形式を前提にしている。

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const absoluteUrl = (site: URL, path: string) =>
  new URL(path.replace(/^\/+/, ''), site).href;

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('astro.config.mjs の site が設定されていません');

  // base（/claude-code-blog-site）を含めた絶対URLの基点
  const baseUrl = new URL(
    `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`,
    site
  );

  const posts = (await getSortedPosts()).slice(0, SITE.feedPostsLimit);
  const updated = posts.length
    ? posts[0]!.data.date.toISOString()
    : new Date(0).toISOString();

  const entry = (post: Post) => {
    const url = absoluteUrl(baseUrl, `${permalinkToParam(post.data.permalink)}/`);
    const published = post.data.date.toISOString();
    return `  <entry>
    <title type="html">${escapeXml(post.data.title)}</title>
    <link href="${escapeXml(url)}" rel="alternate" type="text/html" title="${escapeXml(post.data.title)}"/>
    <published>${published}</published>
    <updated>${published}</updated>
    <id>${escapeXml(url)}</id>
    <author><name>${escapeXml(SITE.author)}</name></author>${
      post.data.excerpt
        ? `\n    <summary type="html">${escapeXml(post.data.excerpt)}</summary>`
        : ''
    }
  </entry>`;
  };

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <generator uri="https://astro.build/" version="1.0">Astro</generator>
  <link href="${escapeXml(absoluteUrl(baseUrl, 'feed.xml'))}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(baseUrl.href)}" rel="alternate" type="text/html"/>
  <updated>${updated}</updated>
  <id>${escapeXml(baseUrl.href)}</id>
  <title type="html">${escapeXml(SITE.title)}</title>
  <subtitle>${escapeXml(SITE.description)}</subtitle>
  <author><name>${escapeXml(SITE.author)}</name></author>
${posts.map(entry).join('\n')}
</feed>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
};
