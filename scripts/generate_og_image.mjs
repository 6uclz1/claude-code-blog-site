#!/usr/bin/env node
/**
 * SNS共有用のOGP画像（public/og.png）を生成する。
 *
 * 生成した PNG はリポジトリにコミットして使う。ビルド時に毎回作ると
 * 画像ライブラリとフォントの有無にデプロイが左右されるため、
 * デザインを変えたいときだけ手で実行する:
 *
 *     node scripts/generate_og_image.mjs
 *
 * 文字は SVG のパス化ではなくフォント名で指定しているので、実行環境に
 * DejaVu Sans（Linux なら大抵入っている）が必要。日本語は環境差が大きいため
 * 画像には入れず、サイト名とURLだけを置いている。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'public', 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;

// src/styles/global.css の配色に合わせる
const BG = '#09090b';
const FG = '#f4f4f1';

const TITLE = 'Bookmark Digest';
const SUBTITLE = '6uclz1.github.io/claude-code-blog-site';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="glowTopLeft" cx="0" cy="0" r="1">
      <stop offset="0%" stop-color="#7f7f7f" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#7f7f7f" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glowBottomRight" cx="1" cy="1" r="1">
      <stop offset="0%" stop-color="#7f7f7f" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#7f7f7f" stop-opacity="0" />
    </radialGradient>
    <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="8" r="1.4" fill="${FG}" fill-opacity="0.16" />
    </pattern>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowTopLeft)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowBottomRight)" />
  <rect x="620" y="0" width="580" height="${HEIGHT}" fill="url(#dots)" />

  <text x="96" y="316" font-family="DejaVu Sans" font-size="72" font-weight="300"
        letter-spacing="8" fill="${FG}">${TITLE}</text>
  <text x="100" y="382" font-family="DejaVu Sans" font-size="26" font-weight="300"
        letter-spacing="3" fill="${FG}" fill-opacity="0.62">${SUBTITLE}</text>

  <rect x="96" y="470" width="120" height="1" fill="${FG}" fill-opacity="0.28" />
</svg>
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, await sharp(Buffer.from(svg)).png().toBuffer());
console.log(`OGP画像を生成しました: ${OUTPUT}`);
