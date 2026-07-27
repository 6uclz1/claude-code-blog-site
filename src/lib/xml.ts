/**
 * feed.xml / sitemap.xml で共用する XML エスケープ。
 * 同じ処理を2箇所に置くと片方だけ直して食い違うため、ここに集約する。
 */

/** XML のテキストノード・属性値に安全に埋め込める形にする */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `type="html"` の要素の中身に入れるテキスト。
 *
 * 中身はHTMLなので、テキストはHTML用とXML用に二重にエスケープする。
 * 1回だけだとリーダー側でXMLを解いた結果が `<Suspense>` のようなHTMLタグになり、
 * その部分が表示から消えてしまう。
 */
export function escapeHtmlText(value: string): string {
  return escapeXml(escapeXml(value));
}
