/**
 * 記事の Markdown 版（`/2026/07/31/hatena-bookmarks.md`）の組み立て。
 *
 * HTML を解析できない読み手（AIエージェントなど）が本文をそのまま読めるようにする。
 * `src/pages/[...slug].md.ts` が使う。astro:content を読まないので単体テストできる。
 */

// front matter は _posts/ を書くときと同じシリアライザを通す。
// 実装が分かれると「Astro は読めるのに配信した .md は壊れている」ずれが起きうる。
import { buildFrontMatter } from '../../scripts/lib/frontmatter';
import { permalinkToParam } from './format';

export interface PostMarkdownInput {
  title: string;
  date: Date;
  /** front matter の updated（公開後に直した記事だけが持つ） */
  updated?: Date;
  permalink: string;
  excerpt?: string;
  /** front matter を除いた本文 */
  body: string;
  /** HTML版のURL。読み手が引用元として示せるように front matter に入れる */
  url: string;
}

/**
 * 記事の Markdown 版のパス。
 * `/2026/07/31/hatena-bookmarks/` -> `/2026/07/31/hatena-bookmarks.md`
 */
export function postMarkdownPath(permalink: string): string {
  return `/${permalinkToParam(permalink)}.md`;
}

/** 記事の Markdown 版（front matter + 本文）を組み立てる */
export function renderPostMarkdown(post: PostMarkdownInput): string {
  const frontMatter = buildFrontMatter({
    title: post.title,
    date: post.date.toISOString(),
    ...(post.updated ? { updated: post.updated.toISOString() } : {}),
    permalink: post.permalink,
    ...(post.excerpt ? { excerpt: post.excerpt } : {}),
    source: post.url,
  });
  // 本文の末尾に改行が無い記事があるため、必ず1つだけ付けて終わる
  return `${frontMatter}\n${post.body.replace(/\s*$/, '')}\n`;
}
