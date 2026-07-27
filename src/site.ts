// Jekyll の _config.yml にあったサイト情報。
// title / description はサイトの見せ方そのものなので、変えるならオーナーの判断で。
export const SITE = {
  title: 'Blog',
  description: 'シンプルなブログ',
  author: '6uclz1',
  lang: 'ja',
  /** feed.xml に載せる記事数（jekyll-feed の posts_limit 相当） */
  feedPostsLimit: 20,
} as const;
