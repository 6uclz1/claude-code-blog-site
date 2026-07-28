/**
 * GitHub Actions のジョブサマリへの出力。
 *
 * ワークフローが成功しても記事から抜け落ちたブックマークがあることは
 * ログを開かないと分からない。実行結果の要点はサマリに残しておく。
 * ローカル実行（GITHUB_STEP_SUMMARY が無い）では何もしない。
 */

import { appendFile } from 'node:fs/promises';

import { describeError, logger } from './logger.ts';

export async function appendJobSummary(markdown: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  try {
    await appendFile(file, `${markdown}\n`, 'utf-8');
  } catch (error) {
    // サマリが書けないだけで記事の生成を失敗させる理由はない
    logger.warn(`Could not write job summary: ${describeError(error)}`);
  }
}
