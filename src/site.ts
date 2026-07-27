// Jekyll の _config.yml にあったサイト情報。
// title / description はサイトの見せ方そのものなので、変えるならオーナーの判断で。
export const SITE = {
  title: 'Blog',
  description: 'シンプルなブログ',
  author: '6uclz1',
  lang: 'ja',
  /** feed.xml に載せる記事数（jekyll-feed の posts_limit 相当） */
  feedPostsLimit: 20,
  /**
   * SNS共有用のOGP画像（public/ からのパス）。
   * `node scripts/generate_og_image.mjs` で作り直せる。
   */
  ogImage: '/og.png',
} as const;
