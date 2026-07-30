/**
 * URLの見た目を整える処理。
 *
 * はてなのRSSはブックマークのタイトルをURLのまま返すことがあり、そのURLは
 * 日本語部分がパーセントエンコードされている（`%E7%99%BB%E5%A3%87...`）。
 * そのまま見出しや一覧に出すと日本語が読めないので、表示に使う文字列は
 * ここでデコードしてから渡す。リンク先として使うURL自体は書き換えない。
 */

/** 表示に出すと崩れる制御文字（デコード結果に混ざったら元の表記のまま残す） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * パーセントエンコードされた並びを元の文字に戻す。
 *
 * 途中に壊れた並び（`%zz` や切れた `%E3%81`）があってもそこだけ元のまま残し、
 * 読める部分は読めるようにする。`decodeURIComponent` を文字列全体にかけると
 * 壊れた並びが1つあるだけで例外になり、全体が生のまま出てしまう。
 */
export function decodePercentEncoding(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (sequence) => {
    try {
      const decoded = decodeURIComponent(sequence);
      return CONTROL_CHARS.test(decoded) ? sequence : decoded;
    } catch {
      return sequence;
    }
  });
}

/** 文字列がURLそのものか（タイトルがURLで埋められているかの判定） */
export function isUrlLike(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/**
 * 見出しや一覧に出すタイトル。
 *
 * タイトルがURLで埋まっているとき（元記事のタイトルが取れなかったとき）だけ
 * パーセントエンコードを解いて、日本語が読める形にする。
 * 通常のタイトルは `%` を含んでいても文章なので触らない。
 */
export function displayTitle(title: string): string {
  return isUrlLike(title) ? decodePercentEncoding(title) : title;
}
