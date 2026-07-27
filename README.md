# Claude Code Blog Site

Astro で構築された日本語のブログサイトです。モダンなデザインとページネーション機能、シンタックスハイライト機能を備えています。

## 🚀 機能

- **レスポンシブデザイン**: モバイルファーストのCSS設計
- **日本語対応**: 日本語ローカライゼーション対応
- **ページネーション**: 1ページ10記事の設定
- **シンタックスハイライト**: Shikiによるビルド時ハイライト
- **Atomフィード**: `/feed.xml` を配信
- **自動コンテンツ生成**: Gemini AIを使用したはてなブックマーク要約の自動生成
- **Docker対応**: 開発環境とプロダクション環境の両方でDocker対応

## 📋 必要な環境

- Node.js 22以上
- Docker & Docker Compose（推奨）
- Python 3.8以上（自動化スクリプト用）

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

# Python依存関係をインストール（自動化スクリプト用）
pip install -r requirements.txt
```

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
```

### 公開前の検証

```bash
npm run build 2>&1 | tee build.log
python scripts/validate_build.py --log build.log --feed dist/feed.xml
```

### Docker関連

```bash
# 開発サーバー起動
docker compose up astro

# Pythonスクリプト実行
docker compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python scripts/fetch_and_summarize.py
"
```

### テスト実行

```bash
# 全テストをカバレッジ付きで実行（Docker）
docker compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python test_runner.py --coverage
"

# テストを直接実行
python test_runner.py
python test_runner.py --coverage

# 特定のテストを実行
python -m pytest tests/test_fetch_and_summarize.py::TestClass::test_method -v
```

## 🏗️ プロジェクト構造

```
├── astro.config.mjs         # Astro設定ファイル
├── package.json             # Node依存関係
├── docker-compose.yml       # Docker開発環境設定
├── Dockerfile               # 開発環境
├── Dockerfile.production    # プロダクション環境
├── _posts/                  # ブログ記事（Markdown・コンテンツソース）
├── src/
│   ├── content.config.ts    # コンテンツコレクション定義
│   ├── site.ts              # サイトのメタ情報
│   ├── lib/posts.ts         # 記事の取得・整形ユーティリティ
│   ├── layouts/             # レイアウト
│   ├── components/          # 再利用可能コンポーネント
│   ├── pages/               # ルーティング（一覧・記事・feed.xml）
│   └── styles/global.css    # カスタムCSS
├── scripts/                 # 自動化スクリプト
│   ├── fetch_and_summarize.py
│   └── validate_build.py
├── tests/                   # ユニットテスト
├── requirements.txt         # Python依存関係
└── .github/workflows/       # CI/CD設定
```

## 📝 記事の作成

記事は `_posts/` ディレクトリに以下の形式で作成してください：

```markdown
---
title: "記事タイトル"
date: 2024-01-01 12:00:00 +0900
permalink: /2024/01/01/article-slug/
excerpt: "記事の要約"
---

記事の内容をここに記述...
```

`permalink` がそのまま記事のURLになります（ファイル名の日付と一致させてください）。

## 🤖 自動化機能

### はてなブックマーク要約

`scripts/fetch_and_summarize.py` スクリプトは以下の機能を提供します：

1. **RSS処理**: はてなブックマークのRSSフィードを取得し、前日分だけを抽出
2. **コンテンツ抽出**: BeautifulSoupを使用した記事内容の抽出
3. **AI要約**: Gemini APIでJSON（`summary` / `points`）を生成
4. **Markdown生成**: 1件あたり「1行サマリ + 箇条書き最大3点」で `_posts/` に記事を生成

朝にパラッと読める分量にするため、要約の長さはスクリプト側で制限しています
（`SUMMARY_MAX_CHARS` / `POINT_MAX_CHARS` / `MAX_POINTS`）。

```bash
# ファイルを書かずに出力を確認する（対象日の指定も可能）
python scripts/fetch_and_summarize.py --dry-run
python scripts/fetch_and_summarize.py --date 2026-07-26 --dry-run
```

記事本文は通常HTMLを直接取得して抽出しますが、Twitter/X のようにJavaScriptで描画される
サイトは本文が取れないため、[r.jina.ai](https://r.jina.ai/) 経由でレンダリング済みの
テキストを取得します。他のサイトでも本文が取れなかった場合は r.jina.ai にフォールバックします。

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
3. `scripts/validate_build.py` による公開前検証
4. GitHub Pagesへの自動デプロイ

## 🎨 カスタマイズ

### カラーパレット

- **背景**: #0f172a（ダークネイビー）
- **カード**: #1e293b
- **アクセント**: #60a5fa（ブルー）

### フォント

日本語対応フォントスタックを使用：
- Helvetica Neue
- Hiragino Sans
- Yu Gothic
- sans-serif

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。
