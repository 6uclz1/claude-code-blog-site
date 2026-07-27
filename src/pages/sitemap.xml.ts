import type { APIRoute } from 'astro';
import { getSortedPosts, permalinkToParam } from '../lib/posts';

// 記事とトップページのサイトマップ。ページ送り(/pageN/)は同じ記事の一覧で
// 中身が薄いため載せない（各ページには noindex を付けている）。

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('astro.config.mjs の site が設定されていません');

  const baseUrl = new URL(
    `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/`,
    site
  );
  const posts = await getSortedPosts();

  const urls = [
    { loc: baseUrl.href, lastmod: posts[0]?.data.date },
    ...posts.map((post) => ({
      loc: new URL(`${permalinkToParam(post.data.permalink)}/`, baseUrl).href,
      lastmod: post.data.date,
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
