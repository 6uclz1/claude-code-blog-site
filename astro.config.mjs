// @ts-check
import { defineConfig } from 'astro/config';

// Jekyll 時代の設定を引き継いでいる:
//   site + base  -> _config.yml の url / baseurl
//   trailingSlash -> permalink が /:year/:month/:day/:title/ で末尾スラッシュ付きのため
export default defineConfig({
  site: 'https://6uclz1.github.io',
  base: '/claude-code-blog-site',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  markdown: {
    // Jekyll (Rouge) と同じくビルド時にシンタックスハイライトする
    // （サイトはダークテーマ固定なので、配色もダーク側に合わせている）
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
});
