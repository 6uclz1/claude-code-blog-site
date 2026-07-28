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
      exclude: ['**/*.test.ts'],
      reporter: ['text', 'html'],
    },
  },
});
