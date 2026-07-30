import { describe, expect, it } from 'vitest';

import { decodePercentEncoding, displayTitle, isUrlLike } from './url';

describe('decodePercentEncoding', () => {
  it('パーセントエンコードされた日本語を戻す', () => {
    expect(
      decodePercentEncoding('https://ja.wikipedia.org/wiki/%E5%9C%B0%E6%96%B9%E7%97%85')
    ).toBe('https://ja.wikipedia.org/wiki/地方病');
  });

  it('エンコードされていない文字列はそのまま', () => {
    expect(decodePercentEncoding('https://example.com/a-b_c')).toBe('https://example.com/a-b_c');
  });

  it('壊れた並びはその部分だけ元のまま残す', () => {
    // %zz は解けない。全体を decodeURIComponent すると例外になり、
    // 読める部分まで生のままになってしまう
    expect(decodePercentEncoding('https://example.com/%zz/%E6%97%A5')).toBe(
      'https://example.com/%zz/日'
    );
  });

  it('途中で切れたUTF-8の並びもその部分だけ残す', () => {
    expect(decodePercentEncoding('https://example.com/%E3%81/%E6%97%A5')).toBe(
      'https://example.com/%E3%81/日'
    );
  });

  it('制御文字になる並びはデコードしない', () => {
    expect(decodePercentEncoding('https://example.com/a%0Ab')).toBe('https://example.com/a%0Ab');
  });

  it('スペースや記号のエンコードも戻す', () => {
    expect(decodePercentEncoding('%E6%97%A5%20%28%E6%9C%AC%29')).toBe('日 (本)');
  });
});

describe('isUrlLike', () => {
  it('URLだけの文字列を判定する', () => {
    expect(isUrlLike('https://example.com/a')).toBe(true);
    expect(isUrlLike('  http://example.com/a  ')).toBe(true);
  });

  it('URLを含むだけの文章はURLではない', () => {
    expect(isUrlLike('記事 https://example.com/a について')).toBe(false);
    expect(isUrlLike('100%E3%81 の話')).toBe(false);
    expect(isUrlLike('')).toBe(false);
  });
});

describe('displayTitle', () => {
  it('タイトルがURLのときだけデコードする', () => {
    expect(displayTitle('https://example.com/%E7%99%BB%E5%A3%87%E8%B3%87%E6%96%99.pdf')).toBe(
      'https://example.com/登壇資料.pdf'
    );
  });

  it('通常のタイトルは % を含んでいても触らない', () => {
    expect(displayTitle('CPU使用率が100%E5に見える話')).toBe('CPU使用率が100%E5に見える話');
  });
});
