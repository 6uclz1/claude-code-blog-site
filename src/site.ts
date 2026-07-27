// Jekyll の _config.yml にあったサイト情報
export const SITE = {
  title: 'Blog',
  description: 'シンプルなブログ',
  author: 'Blog Author',
  lang: 'ja',
  /** feed.xml に載せる記事数（jekyll-feed の posts_limit 相当） */
  feedPostsLimit: 20,
} as const;
