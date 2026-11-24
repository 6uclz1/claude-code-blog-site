/** ファイルまわりの小さなヘルパー */

import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * ディレクトリ配下のファイルを再帰的にたどり、`dirPath` からの相対パス
 * （区切りは常に `/`）を返す。
 */
export async function listFilesRecursively(dirPath: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(path.relative(dirPath, full).split(path.sep).join('/'));
    }
  };

  await walk(dirPath);
  return found;
}

/**
 * ファイルがまだ無いときだけ書き出す。書いたら true、既にあれば false。
 *
 * 記事は上書きすると既存の内容を失うので、存在確認と書き込みを分けずに
 * `wx`（既にあれば失敗）で1回で済ませる。それ以外の失敗は例外のまま返す。
 */
export async function writeFileIfAbsent(filePath: string, content: string): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
