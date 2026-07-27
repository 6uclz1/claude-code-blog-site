import { defineConfig } from 'vitest/config';

// src/lib のうち astro:content に依存しない純粋なモジュールを対象にする。
// （Astroの仮想モジュールはビルド時にしか存在しないため、テストからは読めない）
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
