/**
 * 記事データに依存しない純粋な整形処理。
 *
 * `src/lib/posts.ts` は `astro:content` を読むため単体テストから直接読み込めない。
 * テストしたいロジックはこちら側に置き、posts.ts からは再エクスポートする。
 */

/**
 * permalink から Astro のルートパラメータを作る。
 * `/2026/07/26/hatena-bookmarks/` -> `2026/07/26/hatena-bookmarks`
 */
export function permalinkToParam(permalink: string): string {
  return permalink.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * 日本語表記の日付（例: 2026年07月26日）
 *
 * Jekyll と同じく UTC で表示する。記事の date は翌朝JSTの配信時刻なので、
 * UTCで表示するとブックマーク日（= permalink の日付）と一致する。
 */
// Intl.DateTimeFormat の生成は安くないため、記事ごとに作り直さず使い回す
const DATE_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateJa(date: Date): string {
  const parts = DATE_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}年${get('month')}月${get('day')}日`;
}

/** 記事の年（UTC基準。formatDateJa と同じ日付になる） */
export function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

/** meta description 用にHTMLタグと改行を落として切り詰める */
export function toDescription(text: string, length = 160): string {
  const plain = text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length)}...` : plain;
}
