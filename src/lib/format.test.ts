import { describe, expect, it } from 'vitest';

import { formatDateJa, permalinkToParam, toDescription, yearOf } from './format';

describe('permalinkToParam', () => {
  it('前後のスラッシュを落とす', () => {
    expect(permalinkToParam('/2026/07/26/hatena-bookmarks/')).toBe(
      '2026/07/26/hatena-bookmarks'
    );
  });

  it('スラッシュが無くてもそのまま返す', () => {
    expect(permalinkToParam('about')).toBe('about');
  });
});

describe('formatDateJa', () => {
  it('UTC基準の日付を日本語表記にする', () => {
    expect(formatDateJa(new Date('2026-07-26T00:00:00Z'))).toBe('2026年07月26日');
  });

  it('JSTの朝9時はUTCでは同日0時なので日付がずれない', () => {
    // 記事の date は「ブックマーク日の翌朝9時 JST」で入る
    expect(formatDateJa(new Date('2026-07-27T09:00:00+09:00'))).toBe('2026年07月27日');
  });

  it('月日は0埋めする', () => {
    expect(formatDateJa(new Date('2026-01-02T00:00:00Z'))).toBe('2026年01月02日');
  });
});

describe('yearOf', () => {
  it('formatDateJa と同じくUTC基準の年を返す', () => {
    const date = new Date('2027-01-01T00:00:00Z');
    expect(yearOf(date)).toBe(2027);
    expect(formatDateJa(date).startsWith('2027')).toBe(true);
  });
});

describe('toDescription', () => {
  it('HTMLタグと連続する空白を落とす', () => {
    expect(toDescription('<p>要約の\n  文章</p>')).toBe('要約の 文章');
  });

  it('長い文章は指定長で切って省略記号を付ける', () => {
    expect(toDescription('あ'.repeat(200)).length).toBe(163);
    expect(toDescription('あいうえお', 3)).toBe('あいう...');
  });

  it('ちょうどの長さなら切らない', () => {
    expect(toDescription('あいう', 3)).toBe('あいう');
  });
});
