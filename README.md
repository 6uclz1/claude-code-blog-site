# Bookmark Digest

はてなブックマークでブックマークした記事を毎日まとめて要約する、Astro で構築された日本語のサイトです。Gemini による自動要約と週次のふりかえり記事を、ページネーション・全文検索つきで配信しています。

## 🚀 機能

- **レスポンシブデザイン**: モバイルファーストのCSS設計
- **日本語対応**: 日本語ローカライゼーション対応
- **ページネーション**: 1ページ10記事の設定
- **シンタックスハイライト**: Shikiによるビルド時ハイライト
- **Atomフィード**: `/feed.xml` を配信（本文は載せず、タイトルとリンクのみ）
- **全文検索**: Pagefind による静的サイト内検索（`/search/`）
- **アーカイブ / 集計**: 年別アーカイブ（`/archive/`）とブックマーク先サイトの集計（`/sites/`）
- **SEO / 共有**: OGP画像・JSON-LD（BlogPosting）・サイトマップ。記事ページの
  `og:description` にはその日のブックマーク一覧を1件1行で入れ、Slackなどのリンク展開
  だけで中身が分かるようにしています（フィード側と二重に出さないため）
- **自動コンテンツ生成**: Gemini AIを使用したはてなブックマーク要約の自動生成と、週次のふりかえり記事
- **Docker対応**: 開発環境とプロダクション環境の両方でDocker対応

## 📋 必要な環境

- Node.js 24以上（自動化スクリプトも TypeScript なので Node だけで動きます）
  CI と Docker は Node 24（Active LTS）を使います
- Docker & Docker Compose（推奨）

## 🛠️ 環境構築

### Docker を使用した開発（推奨）

```bash
# リポジトリをクローン
git clone https://github.com/6uclz1/claude-code-blog-site.git
cd claude-code-blog-site

# 開発サーバーを起動
docker compose up astro

# バックグラウンドで実行
docker compose up -d astro

# サービスを停止
docker compose down
```

### 直接開発環境を構築

```bash
# Node依存関係をインストール
npm ci

# 開発サーバーを起動（http://localhost:4000/claude-code-blog-site/）
npm run dev
```

自動化スクリプト（`scripts/*.ts`）も同じ `npm ci` で動きます。実行は
[tsx](https://tsx.is/) 経由なので、ビルドやトランスパイルの手順はありません。

## 🖥️ 開発コマンド

### Astro関連

```bash
# 開発サーバー起動（ホットリロード付き）
npm run dev

# プロダクション用ビルド（出力先: dist/）
npm run build

# ビルド結果をローカルで確認
npm run preview

# 型チェック
npm run check

# 単体テスト（src/lib と scripts/ の両方）
npm test

# OGP画像を作り直す（public/og.png）
npm run og
```

`npm run build` は Astro のビルドに続けて Pagefind の索引作成（`dist/pagefind/`）まで行います。
`npm run dev` では索引が無いため `/search/` は動きません（`npm run build && npm run preview` で確認できます）。

### 公開前の検証

```bash
npm run build 2>&1 | tee build.log
npm run validate -- --log build.log --feed dist/feed.xml --dist dist
```

`--dist` を渡すと、`_posts/` の記事がすべてページとして出力されているかも検査します
（feed.xml は最新20件しか載らないため、それより古い記事の消失はこの検査で捕まえます）。

### 公開中のサイトの異常検知

```bash
npm run health-check
```

公開されている `feed.xml` を取りに行き、壊れていないか・最新記事が古すぎないかを確かめます。
公開前の検証はビルドした結果しか見ないため、「cron が止まった」「実行は成功したのに記事が
増えていない」といった静かな壊れ方はこちらでしか気づけません。
`health-check.yml` が毎日 10:00 JST に実行し、異常があれば issue を立てます。

### カバレッジ

```bash
npm run test:coverage
npm run coverage-report -- --min-lines 85
```

プルリクエストでは `test.yml` が同じ内容をコメントとして貼り、行カバレッジが 85% を
下回ると失敗させます。コメントは毎回作り直さず同じものを更新します。

### Docker関連

```bash
# 開発サーバー起動
docker compose up astro

# 自動化スクリプト実行
docker compose run --rm scripts npm run summarize
```

### テスト実行

```bash
# 全テストを実行
npm test

# カバレッジ付き
npm run test:coverage

# ファイル単位・テスト名で絞り込む
npx vitest run tests/fetch-and-summarize.test.ts
npx vitest run -t 'r.jina.ai'

# Docker で実行
docker compose run --rm scripts npm test
```

## 🏗️ プロジェクト構造

```
├── astro.config.mjs         # Astro設定ファイル
├── package.json             # Node依存関係
├── docker-compose.yml       # Docker開発環境設定
├── Dockerfile               # 開発環境
├── Dockerfile.production    # プロダクション環境
├── _posts/                  # ブログ記事（Markdown・コンテンツソース）
├── public/og.png            # OGP画像（scripts/generate_og_image.mjs で生成）
├── src/
│   ├── content.config.ts    # コンテンツコレクション定義
│   ├── site.ts              # サイトのメタ情報
│   ├── lib/                 # 記事の取得・整形ユーティリティ（*.test.ts は vitest）
│   ├── layouts/             # レイアウト
│   ├── components/          # 再利用可能コンポーネント
│   ├── pages/               # ルーティング（一覧・記事・アーカイブ・検索・feed.xml など）
│   └── styles/global.css    # カスタムCSS
├── scripts/                 # 自動化スクリプト（TypeScript / tsx で実行）
│   ├── fetch-and-summarize.ts
│   ├── build-weekly-digest.ts
│   ├── validate-build.ts
│   ├── check-site-health.ts # 公開中のサイトの異常検知
│   ├── coverage-report.ts   # カバレッジをPRコメント用のMarkdownにする
│   ├── generate_og_image.mjs
│   └── lib/                 # RSS・本文抽出・日付・front matter などの共通部品
├── tests/                   # scripts/ のユニットテスト（vitest）
└── .github/
    ├── workflows/           # CI/CD設定
    ├── actions/             # ワークフローで共有する composite action
    └── dependabot.yml       # Action と npm パッケージの更新
```

## 📝 記事の作成

記事は `_posts/` ディレクトリに以下の形式で作成してください：

```markdown
---
title: "記事タイトル"
date: 2024-01-01 12:00:00 +0900
permalink: /2024/01/01/article-slug/
excerpt: "記事の要約"
# 公開後に直したときだけ。feed の <updated> と sitemap の <lastmod> に反映されます
# updated: 2024-01-02 09:00:00 +0900
---

記事の内容をここに記述...
```

`permalink` がそのまま記事のURLになります（ファイル名の日付と一致させてください）。

## 🤖 自動化機能

### はてなブックマーク要約

`scripts/fetch-and-summarize.ts` スクリプトは以下の機能を提供します：

1. **RSS処理**: はてなブックマークのRSSフィードを取得し、前日分だけを抽出
2. **コンテンツ抽出**: cheerio を使用した記事内容の抽出
3. **AI要約**: Gemini API（`@google/genai`）でJSON（`summary` / `points`）を生成。
   全件の要約に失敗した場合は記事を作らずに終了コード1で終わります
4. **Markdown生成**: 1件あたり「1行サマリ + 箇条書き最大3点」で `_posts/` に記事を生成

朝にパラッと読める分量にするため、要約の長さはスクリプト側で制限しています
（`SUMMARY_MAX_CHARS` / `POINT_MAX_CHARS` / `MAX_POINTS`）。

```bash
# ファイルを書かずに出力を確認する（対象日の指定も可能）
npm run summarize -- --dry-run
npm run summarize -- --date 2026-07-26 --dry-run
```

ブックマークはあったのに本文が1件も取得できなかった場合と、要約が全滅した場合は、
記事を作らずに終了コード1で終わります（無言で記事が欠けるのを防ぐため）。
その日の記事が既にある場合は要約もせずに終了します。

記事本文は通常HTMLを直接取得して抽出しますが、Twitter/X のようにJavaScriptで描画される
サイトは本文が取れないため、[r.jina.ai](https://r.jina.ai/) 経由でレンダリング済みの
テキストを取得します。他のサイトでも本文が取れなかった場合は r.jina.ai にフォールバックします。

### 週刊まとめ

`scripts/build-weekly-digest.ts` は、日次のまとめ記事7日分から「週刊まとめ」を1本作ります。
要約は日次記事のものを流用するため Gemini API は呼びません。

```bash
# 週の最終日を指定して出力を確認する（既定は日本時間の昨日）
npm run weekly-digest -- --week-ending 2026-07-26 --dry-run
```

毎週月曜 9:30 JST に `weekly-digest.yml` が実行します。

### 欠損日の埋め方

自動更新が数日続けて失敗すると、はてなブックマークのRSSの取得範囲から外れて
その日の記事を作れなくなります。日付を指定して手動で生成してください。

```bash
npm run summarize -- --date 2026-07-20
```

### 環境変数

```bash
# Gemini API キー（GitHub Actions用）
GEMINI_API_KEY=your_api_key_here

# r.jina.ai の API キー（任意。未設定でも動作しますが、設定するとレート制限が緩和されます）
JINA_API_KEY=your_jina_api_key_here
```

## 🚀 デプロイ

GitHub Pagesを使用した自動デプロイが設定されています：

1. `main` ブランチへのプッシュ
2. GitHub ActionsでAstroビルド実行
3. `scripts/validate-build.ts` による公開前検証
4. GitHub Pagesへの自動デプロイ

自動更新ワークフロー（`update-blog.yml` / `weekly-digest.yml`）は記事をコミットして push した
あと、`deploy.yml` を再利用ワークフロー（`workflow_call`）として呼び出して公開します。
デプロイを行うのは `deploy.yml` だけです（Pages への同時デプロイを避けるため）。

`GITHUB_TOKEN` による push は他のワークフローを起動しない仕様なので、`deploy.yml` の push
トリガーは自動生成された記事では発火しません。そのため呼び出しは省略できません。

## 🎨 カスタマイズ

配色・余白・タイポグラフィはすべて `src/styles/global.css` の `:root` にある
CSS変数で管理しています。

### カラーパレット

ダークテーマ固定で、アクセント色は使いません。

- **背景**: `--bg` #09090b
- **文字**: `--fg` #f4f4f1
- **補助・罫線・パネル**: `--muted` / `--line` / `--panel`（前景色の半透明）

### フォント

日本語対応のシステムフォントスタック（`--font-sans`）を使用：
- -apple-system / BlinkMacSystemFont / Segoe UI / Helvetica Neue
- Hiragino Sans / Hiragino Kaku Gothic ProN / Yu Gothic / Meiryo
- sans-serif
