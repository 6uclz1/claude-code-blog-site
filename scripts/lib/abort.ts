/**
 * 記事を作らずに異常終了すべき状況（設定不備・要約の全滅など）。
 *
 * 日次・週刊の両方のスクリプトが同じ意味で使うため、ここに1つだけ置く。
 */
export class AbortRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortRun';
  }
}
