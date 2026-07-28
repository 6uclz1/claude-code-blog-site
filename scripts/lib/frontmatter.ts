/**
 * 記事の front matter の読み書き。
 *
 * front matter が壊れると Astro が記事を読み込めず、サイトとフィードから
 * その記事が消える。手で組み立てず必ず YAML シリアライザを通す。
 */

// Astro の front matter パーサ（js-yaml）と同じ実装を使う。
// ライブラリが違うと「書けたのに Astro が読めない」ずれが起きうる
import { dump } from 'js-yaml';

/** `---` で囲まれた front matter。本文との境目を取り出すために使う */
export const FRONT_MATTER_RE = /^---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*\n/;

/**
 * front matter を YAML として安全に組み立てる。
 *
 * タイトルや要約に含まれる `"` や `\` を手で埋め込むと YAML が壊れるため、
 * ここを通さずに文字列連結してはいけない。
 */
export function buildFrontMatter(data: Record<string, unknown>): string {
  const body = dump(data, {
    // 折り返されると 1行のはずの excerpt が複数行になるため無効化する
    lineWidth: -1,
    // 記述順（title → date → permalink → excerpt）を保つ
    sortKeys: false,
    noCompatMode: true,
  });
  return `---\n${body}---\n`;
}

export interface SplitPost {
  /** front matter の中身（`---` は含まない）。無ければ undefined */
  frontMatter?: string;
  /** front matter を除いた本文 */
  body: string;
}

export function splitFrontMatter(text: string): SplitPost {
  const match = FRONT_MATTER_RE.exec(text);
  if (!match) return { body: text };
  return { frontMatter: match[1], body: text.slice(match[0].length) };
}
