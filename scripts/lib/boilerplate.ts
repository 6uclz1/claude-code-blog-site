/**
 * 「取得できたテキスト」が本文ではなく定型文だったかを判定する。
 *
 * 取得先が 200 を返しても中身が本文とは限らない。ログイン誘導・JavaScript必須の
 * 案内・Cookie同意・ボット判定・r.jina.ai のエラー通知は、いずれも文字数だけでは
 * 本文と区別できず、そのまま Gemini に渡すと「Xの利用にはJavaScriptが必要」という
 * 内容の要約が記事に載ってしまう（実際に過去記事がそうなっている）。
 */

/** 定型文の判定に使う先頭部分の長さ。本文中に同じ語が出てきても誤検知しないよう狭くとる */
export const BOILERPLATE_HEAD_CHARS = 400;

/** 定型文のパターンと、ログに出す理由 */
const PATTERNS: [RegExp, string][] = [
  // ボット判定ページも「JavaScriptを有効に」と書くので、先に判定する
  [/Just a moment\.\.\./i, 'ボット判定ページ'],
  [/(?:Attention Required|Checking your browser before accessing)/i, 'ボット判定ページ'],
  [/Are you a (?:robot|human)/i, 'ボット判定ページ'],
  [/JavaScript is not available/i, 'JavaScript必須の案内'],
  [/(?:enable|turn on) JavaScript/i, 'JavaScript必須の案内'],
  [/JavaScript ?を(?:有効|オン)に/, 'JavaScript必須の案内'],
  [/JavaScript ?が(?:無効|オフ)に/, 'JavaScript必須の案内'],
  // r.jina.ai は取得に失敗しても 200 でこの一行だけを返すことがある
  [/Warning: Target URL returned error/i, 'r.jina.ai が取得に失敗'],
  [/Log ?in to (?:X|Twitter)/i, 'ログイン誘導'],
  [/(?:Sign|Log) in to continue/i, 'ログイン誘導'],
  [/ログインしてください/, 'ログイン誘導'],
  [/(?:この|続きを)(?:記事|コンテンツ)(?:を読むに|の閲覧に)は.{0,10}ログイン/, 'ログイン誘導'],
  [/Access (?:to this page has been )?denied/i, 'アクセス拒否ページ'],
  [/(?:403 Forbidden|404 Not Found|Page not found|ページが見つかりません)/i, 'エラーページ'],
  [/(?:We use cookies|Cookieの使用に同意|Cookie の使用に同意)/i, 'Cookie同意バナーのみ'],
];

/**
 * 本文ではなく定型文に見えるなら、その理由を返す（本文らしければ undefined）。
 *
 * 判定はテキストの先頭 `BOILERPLATE_HEAD_CHARS` 文字だけを見る。定型文は必ず
 * ページの先頭に出るのに対し、たとえば「JavaScriptを有効に」という語を含む
 * 技術記事は本文の途中に出てくるため、先頭だけを見れば取り違えない。
 */
export function boilerplateReason(text: string): string | undefined {
  const head = text.slice(0, BOILERPLATE_HEAD_CHARS);
  for (const [pattern, reason] of PATTERNS) {
    if (pattern.test(head)) return reason;
  }
  return undefined;
}
