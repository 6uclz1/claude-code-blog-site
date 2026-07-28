/** テスト用の小道具（一時ディレクトリと front matter の取り出し） */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { load } from 'js-yaml';

import { splitFrontMatter } from '../scripts/lib/frontmatter.ts';

/** テストごとに使い捨てる一時ディレクトリ。afterEach で cleanup() を呼ぶ */
export async function createTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'blog-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function frontMatterOf(markdown: string): Record<string, unknown> {
  const { frontMatter } = splitFrontMatter(markdown);
  if (frontMatter === undefined) throw new Error('フロントマターが見つからない');
  return load(frontMatter) as Record<string, unknown>;
}

export function bodyOf(markdown: string): string {
  return splitFrontMatter(markdown).body;
}

/** fetch のモックが返す Response */
export function okResponse(body: string | Uint8Array, contentType = 'text/html'): Response {
  return new Response(body as BodyInit, { status: 200, headers: { 'content-type': contentType } });
}
