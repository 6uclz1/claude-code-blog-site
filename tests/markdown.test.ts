import { describe, expect, it } from 'vitest';

import { escapeLinkText, markdownLink, markdownLinkDestination } from '../scripts/lib/markdown.ts';
import { extractBookmarks } from '../src/lib/bookmarks.ts';

describe('markdownLinkDestination', () => {
  it('普通のURLはそのまま', () => {
    expect(markdownLinkDestination('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
  });

  it('対応の取れた括弧を含むURLもそのまま（CommonMarkが読める）', () => {
    expect(markdownLinkDestination('https://ja.wikipedia.org/wiki/A_(B)')).toBe(
      'https://ja.wikipedia.org/wiki/A_(B)'
    );
  });

  it('閉じない括弧を含むURLは <> で囲む', () => {
    expect(markdownLinkDestination('https://example.com/a?ct=t(EMAIL')).toBe(
      '<https://example.com/a?ct=t(EMAIL>'
    );
  });

  it('閉じ括弧が先に来るURLも <> で囲む', () => {
    expect(markdownLinkDestination('https://example.com/a)b')).toBe('<https://example.com/a)b>');
  });

  it('空白を含むURLは <> で囲む', () => {
    expect(markdownLinkDestination('https://example.com/a b')).toBe('<https://example.com/a b>');
  });

  it('<> はURLに現れてはいけないのでエンコードする', () => {
    expect(markdownLinkDestination('https://example.com/<a>')).toBe('https://example.com/%3Ca%3E');
  });
});

describe('escapeLinkText', () => {
  it('角括弧をエスケープする', () => {
    expect(escapeLinkText('[速報] 新機能')).toBe('\\[速報\\] 新機能');
  });
});

describe('markdownLink', () => {
  it('壊れたリンクにならず、抽出側でも同じURLに戻る', () => {
    const url = 'https://example.com/a?ct=t(EMAIL';
    const body = `## ${markdownLink('[速報] タイトル', url)}`;

    expect(extractBookmarks(body)).toEqual([{ title: '[速報] タイトル', url }]);
  });

  it('対応の取れた括弧を含むURLも欠けずに抽出できる', () => {
    const url = 'https://ja.wikipedia.org/wiki/%E5%9C%B0%E6%96%B9%E7%97%85_(%E6%97%A5%E6%9C%AC)';
    const body = `## ${markdownLink('地方病', url)}`;

    expect(extractBookmarks(body)).toEqual([{ title: '地方病', url }]);
  });
});
