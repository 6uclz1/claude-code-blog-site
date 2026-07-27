import type { APIRoute } from 'astro';
import { getSortedPosts, permalinkToParam, postUpdated } from '../lib/posts';
import { escapeXml } from '../lib/xml';

// 記事・トップページ・一覧系ページのサイトマップ。ページ送り(/pageN/)は同じ記事の
// 一覧で中身が薄いため載せない（各ページには noindex を付けている）。

/**
 * 記事以外で載せるページ。最終更新は最新記事に合わせる（内容が記事に依存するため）。
 * 検索ページ(/search/)は結果がJavaScript任せで中身が無く noindex なので載せない。
 */
const STATIC_PATHS = ['', 'archive/', 'sites/'];

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('astro.config.mjs の site が設定されていません');

  const baseUrl = new URL(
    `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`,
    site
  );
  const posts = await getSortedPosts();
  const latest = posts.length
    ? new Date(Math.max(...posts.map((post) => postUpdated(post).getTime())))
    : undefined;

  const urls = [
    ...STATIC_PATHS.map((path) => ({
      loc: new URL(path, baseUrl).href,
      lastmod: latest,
    })),
    ...posts.map((post) => ({
      loc: new URL(`${permalinkToParam(post.data.permalink)}/`, baseUrl).href,
      lastmod: postUpdated(post),
    })),
  ];

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, lastmod }) =>
      `  <url><loc>${escapeXml(loc)}</loc>${
        lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''
      }</url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
