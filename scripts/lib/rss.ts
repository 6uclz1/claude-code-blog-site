/**
 * はてなブックマークの RSS を読む。
 *
 * はてなが返すのは RSS 1.0 (RDF) で、日付は `dc:date`、エントリIDは
 * `rdf:about`（`.../20250620#bookmark-xxx`）に入っている。将来 RSS 2.0 や Atom に
 * 変わっても拾えるよう、3形式とも同じ形に正規化して返す。
 */

import { XMLParser } from 'fast-xml-parser';

import { asArray, isNode, textOf, type XmlNode } from './xml-node.ts';

export interface FeedEntry {
  title: string;
  link: string;
  /** RSS 1.0 の `dc:date` */
  dcDate?: string;
  /** `rdf:about` / `guid` / Atom の `id`。日付が埋まっていることがある */
  id?: string;
  /** `pubDate` / Atom の `published` */
  published?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // <title>2026</title> のような値を数値にされると扱いづらい
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Atom の link は `<link href="..."/>`、それ以外は要素のテキスト */
function linkOf(value: unknown): string {
  for (const candidate of asArray(value)) {
    if (isNode(candidate)) {
      const href = candidate['@_href'];
      // Atom は rel="alternate" 以外の link も持つ
      const rel = candidate['@_rel'];
      if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) {
        return href.trim();
      }
      continue;
    }
    const text = textOf(candidate);
    if (text) return text;
  }
  return '';
}

function toEntry(item: XmlNode): FeedEntry {
  const id =
    textOf(item['@_rdf:about']) ||
    textOf(item['@_rdf:resource']) ||
    textOf(item['guid']) ||
    textOf(item['id']) ||
    undefined;

  return {
    title: textOf(item['title']),
    link: linkOf(item['link']),
    dcDate: textOf(item['dc:date']) || undefined,
    id,
    published: textOf(item['pubDate']) || textOf(item['published']) || undefined,
  };
}

/** フィードのXMLをエントリの配列にする。読めなければ空配列 */
export function parseFeed(xml: string): FeedEntry[] {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return [];
  }
  if (!isNode(document)) return [];

  const items: unknown[] = [];
  // RSS 1.0 (RDF): item は channel の外に並ぶ
  for (const rdf of asArray(document['rdf:RDF'])) {
    if (isNode(rdf)) items.push(...asArray(rdf['item']));
  }
  // RSS 2.0
  for (const rss of asArray(document['rss'])) {
    if (!isNode(rss)) continue;
    for (const channel of asArray(rss['channel'])) {
      if (isNode(channel)) items.push(...asArray(channel['item']));
    }
  }
  // Atom
  for (const feed of asArray(document['feed'])) {
    if (isNode(feed)) items.push(...asArray(feed['entry']));
  }

  return items.filter(isNode).map(toEntry);
}
