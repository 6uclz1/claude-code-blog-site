/**
 * 生成する記事のMarkdownを組み立てる小道具。
 *
 * ブックマークのタイトルもURLも外部から来る文字列なので、そのまま
 * `[タイトル](URL)` に流し込むとリンクが壊れることがある。
 * 実例: `...&ct=t(EMAIL_CAMPAIGN_2025_09_25` のように閉じない `(` を含むURLは
 * CommonMark のリンクとして読めず、記事にURLがそのまま出てしまう
 * （_posts/2025-09-25-hatena-bookmarks.md にその状態で残っている）。
 */

/**
 * リンクの `[...]` に入れるテキスト。
 *
 * `[速報]` のような角括弧を含むタイトルはリンクの範囲を壊すのでエスケープする。
 */
export function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1');
}

/**
 * リンクの `(...)` に入れる宛先。
 *
 * 括弧や空白を含むURLは `<...>` で囲む形にする。パーセントエンコードで
 * 書き換えるとURL自体が別物になりうるため、囲むだけにしてURLは変えない。
 * `<` `>` はURLに現れてはいけない文字なので、含むときだけエンコードする。
 */
export function markdownLinkDestination(url: string): string {
  const escaped = url.replace(/</g, '%3C').replace(/>/g, '%3E');
  return needsAngleBrackets(escaped) ? `<${escaped}>` : escaped;
}

/** 空白を含む、または括弧の対応が取れていないURLは裸で書けない */
function needsAngleBrackets(url: string): boolean {
  if (/\s/.test(url)) return true;

  let depth = 0;
  for (const char of url) {
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

/** 壊れないMarkdownリンク */
export function markdownLink(text: string, url: string): string {
  return `[${escapeLinkText(text)}](${markdownLinkDestination(url)})`;
}
