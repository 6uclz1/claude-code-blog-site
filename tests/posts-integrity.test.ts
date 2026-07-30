/**
 * _posts配下の記事が正しく読めることを検証するテスト。
 *
 * フロントマターのYAMLが壊れている記事はビルド時に読み込みに失敗し、
 * 記事がサイトとRSSから消えるため、リポジトリ全体を常にチェックする。
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

import { splitFrontMatter } from '../scripts/lib/frontmatter.ts';

const POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_posts');

interface Post {
  name: string;
  data: Record<string, unknown> | undefined;
  error?: string;
}

async function readPosts(): Promise<Post[]> {
  const names = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md')).sort();

  return Promise.all(
    names.map(async (name) => {
      const { frontMatter } = splitFrontMatter(await readFile(path.join(POSTS_DIR, name), 'utf-8'));
      if (frontMatter === undefined) {
        return { name, data: undefined, error: 'フロントマターがない' };
      }
      try {
        const parsed: unknown = load(frontMatter);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { name, data: undefined, error: 'フロントマターがマッピングでない' };
        }
        return { name, data: parsed as Record<string, unknown> };
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        return { name, data: undefined, error: `YAMLエラー: ${message}` };
      }
    })
  );
}

/**
 * front matter の date を Date にする（読めなければ undefined）。
 *
 * `2026-07-27 08:56:04 +0900` のようなオフセット表記は YAML のタイムスタンプ形式に
 * 合わず文字列のまま渡ってくるため、Astro (z.coerce.date) と同じように解釈する。
 */
function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string') return undefined;

  const text = value.trim();
  // "YYYY-MM-DD HH:MM:SS +0900" / "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD"
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?(?:\s*([+-]\d{2}):?(\d{2}))?$/.exec(
    text
  );
  if (!match) return undefined;

  const time = match[2] ?? '00:00:00';
  const zone = match[3] ? `${match[3]}:${match[4]}` : 'Z';
  const parsed = new Date(`${match[1]}T${time}${zone}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const utcDatePath = (date: Date) =>
  `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/` +
  `${String(date.getUTCDate()).padStart(2, '0')}`;

describe('_posts', () => {
  it('記事が存在する', async () => {
    expect((await readPosts()).length).toBeGreaterThan(0);
  });

  it('全記事のフロントマターがYAMLとして読める', async () => {
    const failures: string[] = [];

    for (const post of await readPosts()) {
      if (!post.data) {
        failures.push(`${post.name}: ${post.error}`);
        continue;
      }
      if (!post.data.title) failures.push(`${post.name}: title がない`);
      else if (!post.data.date) failures.push(`${post.name}: date がない`);
    }

    expect(failures, `フロントマターが壊れている記事:\n${failures.join('\n')}`).toEqual([]);
  });

  it('パーマリンクが一意で、ファイル名の日付と一致する', async () => {
    // 重複するとビルド時に上書きされ、その日の記事がサイトから消える
    const seen = new Map<string, string>();
    const failures: string[] = [];

    for (const post of await readPosts()) {
      const permalink = post.data?.permalink;
      if (typeof permalink !== 'string' || !permalink) {
        if (post.data) failures.push(`${post.name}: permalink がない`);
        continue;
      }

      const expectedPrefix = `/${post.name.slice(0, 10).replace(/-/g, '/')}/`;
      if (!permalink.startsWith(expectedPrefix)) {
        failures.push(`${post.name}: permalink ${permalink} がファイル名の日付と不一致`);
      }

      const duplicate = seen.get(permalink);
      if (duplicate) failures.push(`${post.name}: permalink ${permalink} が ${duplicate} と重複`);
      else seen.set(permalink, post.name);
    }

    expect(failures, `パーマリンクの問題:\n${failures.join('\n')}`).toEqual([]);
  });

  it('date のUTC日付がパーマリンクの日付と一致する', async () => {
    // 記事一覧・記事ページの日付表示は UTC 基準(src/lib/posts.ts)なので、
    // ここがずれると「表示は7月27日なのにURLは7月26日」という記事ができる。
    // 公開前ゲート(validate-build.ts)はフィードの新しい20件しか見ないため、
    // 全記事を対象にするこのテストで担保する。
    const failures: string[] = [];

    for (const post of await readPosts()) {
      const permalink = post.data?.permalink;
      const rawDate = post.data?.date;
      if (typeof permalink !== 'string' || !permalink || !rawDate) continue;

      const parsed = asDate(rawDate);
      if (!parsed) {
        failures.push(`${post.name}: date が日付として読めない: ${String(rawDate)}`);
        continue;
      }

      const expected = `/${utcDatePath(parsed)}/`;
      if (!permalink.startsWith(expected)) {
        failures.push(`${post.name}: 表示日付 ${expected} とパーマリンク ${permalink} がずれている`);
      }
    }

    expect(failures, `日付の不一致:\n${failures.join('\n')}`).toEqual([]);
  });
});

describe('_posts の本文', () => {
  it('Markdownリンクの宛先が壊れていない', async () => {
    // 閉じない `(` や空白を含むURLを裸で書くと CommonMark がリンクとして読めず、
    // 記事にURLの文字列がそのまま出る。生成側(scripts/lib/markdown.ts)は
    // そうしたURLを `<...>` で囲むが、過去記事も含めて崩れていないことを見張る。
    const failures: string[] = [];

    for (const { name, body } of await readPostBodies()) {
      body.split('\n').forEach((line, index) => {
        for (const destination of linkDestinations(line)) {
          if (destination.broken) {
            failures.push(`${name}:${index + 1}: リンクの宛先が読めない: ${destination.text}`);
          }
        }
      });
    }

    expect(failures, `壊れたリンク:\n${failures.join('\n')}`).toEqual([]);
  });

  it('見出しに文字参照が残っていない', async () => {
    // はてなのRSSはタイトルの日本語を `&#x30B3;` のような文字参照で返すことがある。
    // 記事ページはブラウザが解いて日本語に見えるが、フィードと /sites/ では
    // エスケープされて `&amp;#x30B3;` の文字列がそのまま読者に出る
    const failures: string[] = [];

    for (const { name, body } of await readPostBodies()) {
      body.split('\n').forEach((line, index) => {
        if (!line.startsWith('## ')) return;
        const found = line.match(/&#(?:x[0-9A-Fa-f]{1,6}|\d{1,7});/g);
        if (found) failures.push(`${name}:${index + 1}: 文字参照が残っている: ${found[0]}`);
      });
    }

    expect(failures, `未デコードの文字参照:\n${failures.join('\n')}`).toEqual([]);
  });
});

async function readPostBodies(): Promise<{ name: string; body: string }[]> {
  const names = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md')).sort();

  return Promise.all(
    names.map(async (name) => {
      const raw = await readFile(path.join(POSTS_DIR, name), 'utf-8');
      return { name, body: splitFrontMatter(raw).body };
    })
  );
}

/**
 * 行の中の `](...)` を CommonMark と同じ読み方で拾う。
 * 宛先は対応の取れた括弧までで、閉じない括弧や空白があるとリンクにならない。
 */
function linkDestinations(line: string): { text: string; broken: boolean }[] {
  const found: { text: string; broken: boolean }[] = [];
  const pattern = /\]\(\s*(<[^>]*>|[^\s]*)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    const raw = match[1]!;
    // `<...>` で囲まれていれば中身は何でもよい
    if (raw.startsWith('<')) continue;

    let depth = 0;
    let closed = false;
    for (const char of raw) {
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) {
          closed = true;
          break;
        }
        depth -= 1;
      }
    }
    if (!closed || depth > 0) found.push({ text: raw.slice(0, 120), broken: true });
  }

  return found;
}
