import type { APIRoute } from 'astro';
import {
  getSortedPosts,
  permalinkToParam,
  postUpdated,
  type Post,
} from '../lib/posts';
import { escapeHtmlText, escapeXml } from '../lib/xml';
import { SITE } from '../site';

// jekyll-feed と同じ Atom 形式で出力する。
// 既存の購読者と公開前ゲート(scripts/validate-build.ts)がこの形式を前提にしている。
//
// entry には summary を入れない。Slack の RSS 連携は summary を本文として出したうえで
// リンクを展開して OGP の説明文も出すため、両方に中身があると同じ内容が二重に並ぶ。
// 記事の中身は OGP 側（src/lib/share.ts）だけで伝える。

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
  // 記事を直したときに購読側が拾えるよう、フィード全体の updated は
  // 掲載中の entry の updated の最大値にする（公開日順とは限らない）
  const updated = posts.length
    ? new Date(
        Math.max(...posts.map((post) => postUpdated(post).getTime()))
      ).toISOString()
    : new Date(0).toISOString();

  const entry = (post: Post) => {
    const url = absoluteUrl(baseUrl, `${permalinkToParam(post.data.permalink)}/`);
    const published = post.data.date.toISOString();
    return `  <entry>
    <title type="html">${escapeHtmlText(post.data.title)}</title>
    <link href="${escapeXml(url)}" rel="alternate" type="text/html" title="${escapeXml(post.data.title)}"/>
    <published>${published}</published>
    <updated>${postUpdated(post).toISOString()}</updated>
    <id>${escapeXml(url)}</id>
    <author><name>${escapeXml(SITE.author)}</name></author>
  </entry>`;
  };

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <generator uri="https://astro.build/" version="1.0">Astro</generator>
  <link href="${escapeXml(absoluteUrl(baseUrl, 'feed.xml'))}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(baseUrl.href)}" rel="alternate" type="text/html"/>
  <updated>${updated}</updated>
  <id>${escapeXml(baseUrl.href)}</id>
  <title type="html">${escapeHtmlText(SITE.title)}</title>
  <subtitle>${escapeXml(SITE.description)}</subtitle>
  <author><name>${escapeXml(SITE.author)}</name></author>
${posts.map(entry).join('\n')}
</feed>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
};
