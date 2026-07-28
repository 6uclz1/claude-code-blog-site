import { defineConfig } from 'vitest/config';

// src/lib のうち astro:content に依存しない純粋なモジュールと、
// 自動化スクリプト（scripts/ を tests/ から検証する）を対象にする。
// （Astroの仮想モジュールはビルド時にしか存在しないため、テストからは読めない）
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['scripts/**/*.ts', 'src/lib/**/*.ts'],
      // posts.ts は astro:content を読むためテストから import できない。
      // 常に0%として集計されると全体の数字がしきい値判定に使えなくなる
      exclude: ['**/*.test.ts', 'src/lib/posts.ts'],
      // json-summary は scripts/coverage-report.ts が読んで
      // プルリクにコメントする数字のもと
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
