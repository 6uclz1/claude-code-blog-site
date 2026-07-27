import { describe, expect, it } from 'vitest';

import { escapeHtmlText, escapeXml } from './xml';

describe('escapeXml', () => {
  it('XMLの特殊文字をエスケープする', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;'
    );
  });

  it('& を二重にエスケープしない', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});

describe('escapeHtmlText', () => {
  it('type="html" の中身向けに二重エスケープする', () => {
    // XMLを1回解くと "&lt;Suspense&gt;" になり、HTMLとして解かれても
    // タグ扱いされずに <Suspense> と表示される
    expect(escapeHtmlText('<Suspense>')).toBe('&amp;lt;Suspense&amp;gt;');
  });
});
