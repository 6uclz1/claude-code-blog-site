import { describe, expect, it } from 'vitest';

import { boilerplateReason } from '../scripts/lib/boilerplate.ts';

describe('boilerplateReason', () => {
  it('本文ではない定型文を見分ける', () => {
    const cases: [string, string][] = [
      [
        'X (formerly Twitter) JavaScript is not available. We detected that JavaScript is disabled',
        'JavaScript必須の案内',
      ],
      ['このページを見るにはJavaScriptを有効にしてください', 'JavaScript必須の案内'],
      ['Warning: Target URL returned error 404: Not Found', 'r.jina.ai が取得に失敗'],
      ['Log in to X to see this post', 'ログイン誘導'],
      ['Just a moment... Enable JavaScript and cookies to continue', 'ボット判定ページ'],
      ['404 Not Found - nginx', 'エラーページ'],
    ];

    for (const [text, reason] of cases) {
      expect(boilerplateReason(text), text).toBe(reason);
    }
  });

  it('普通の本文は通す', () => {
    expect(boilerplateReason('React Server Component時代の開発について解説します。')).toBeUndefined();
  });

  it('本文の途中に同じ語が出てくる技術記事は誤検知しない', () => {
    // 判定はテキストの先頭だけを見る
    const article = `${'この記事ではブラウザの動作を解説します。'.repeat(30)}JavaScriptを有効にしてください、という案内が出る仕組みも扱います。`;

    expect(boilerplateReason(article)).toBeUndefined();
  });
});
