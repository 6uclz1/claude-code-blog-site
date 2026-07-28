/** ファイルまわりの小さなヘルパー */

import { access, readdir, stat } from 'node:fs/promises';
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
