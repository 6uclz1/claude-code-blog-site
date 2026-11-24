/**
 * このサイト自身が出力する Atom フィード（src/pages/feed.xml.ts）を読む。
 *
 * 公開前ゲート（validate-build.ts）はビルド結果の feed.xml を、異常検知
 * （check-site-health.ts）は公開中の feed.xml を読む。同じ形を2通りに
 * 読んでいたので、ここにまとめる。
 */

import { asArray, attrOf, createXmlParser, isNode, textOf } from './xml-node.ts';

export interface AtomEntry {
  title: string;
  /** 最初の <link> の href。無ければ空文字 */
  link: string;
  /** 無ければ空文字 */
  published: string;
  /** 無ければ空文字 */
  updated: string;
}

const parser = createXmlParser();

/**
 * Atom フィードのエントリを取り出す。`<feed>` が無ければ undefined。
 *
 * パーサは壊れたXMLでも黙って読み進めることがあるので、構文の検査が
 * 必要な呼び出し側は先に済ませておく。
 */
export function parseAtomFeed(xml: string): AtomEntry[] | undefined {
  const document: unknown = parser.parse(xml);
  const feed = isNode(document) ? document['feed'] : undefined;
  if (!isNode(feed)) return undefined;

  return asArray(feed['entry'])
    .filter(isNode)
    .map((entry) => ({
      title: textOf(entry['title']),
      link: attrOf(asArray(entry['link'])[0], 'href'),
      published: textOf(entry['published']),
      updated: textOf(entry['updated']),
    }));
}
