/**
 * fast-xml-parser が返すオブジェクトを扱うための小さなヘルパー。
 *
 * パーサは要素が1つなら値、複数なら配列を返し、属性を持つ要素のテキストは
 * `#text` に入る。この差をここで吸収する。
 */

import { XMLParser, type X2jOptions } from 'fast-xml-parser';

export type XmlNode = Record<string, unknown>;

export function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 単一要素と配列の両方で返ってくるので必ず配列にそろえる */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 要素のテキスト。属性付きの要素は `#text` に入る */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (isNode(value)) {
    const text = value['#text'];
    if (typeof text === 'string' || typeof text === 'number') return String(text).trim();
  }
  return '';
}

/** 属性値。無ければ空文字 */
export function attrOf(value: unknown, name: string): string {
  if (!isNode(value)) return '';
  const attribute = value[`@_${name}`];
  return typeof attribute === 'string' ? attribute.trim() : '';
}

/**
 * このリポジトリで使う XMLParser。属性は `@_` 付きで読み、値は文字列のまま残す
 * （<title>2026</title> のような値を数値にされると扱いづらい）。
 */
export function createXmlParser(options: X2jOptions = {}): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ...options,
  });
}
