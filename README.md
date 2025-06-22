# Claude Code Blog Site

JekyllとRubyを使用して構築された日本語のブログサイトです。モダンなデザインとページネーション機能、シンタックスハイライト機能を備えています。

## 🚀 機能

- **レスポンシブデザイン**: モバイルファーストのCSS設計
- **日本語対応**: 日本語ローカライゼーション対応
- **ページネーション**: 1ページ5記事の設定
- **シンタックスハイライト**: Rougeハイライターによるコードブロック対応
- **自動コンテンツ生成**: Gemini AIを使用したはてなブックマーク要約の自動生成
- **Docker対応**: 開発環境とプロダクション環境の両方でDocker対応

## 📋 必要な環境

- Ruby 3.0以上
- Jekyll 4.3.0
- Docker & Docker Compose（推奨）
- Python 3.8以上（自動化スクリプト用）

## 🛠️ 環境構築

### Docker を使用した開発（推奨）

```bash
# リポジトリをクローン
git clone https://github.com/your-username/claude-code-blog-site.git
cd claude-code-blog-site

# Jekyll開発サーバーを起動
docker-compose up jekyll

# バックグラウンドで実行
docker-compose up -d jekyll

# サービスを停止
docker-compose down
```

### 直接開発環境を構築

```bash
# Ruby依存関係をインストール
bundle install

# Jekyll開発サーバーを起動
bundle exec jekyll serve

# Python依存関係をインストール（自動化スクリプト用）
pip install -r requirements.txt
```

## 🖥️ 開発コマンド

### Jekyll関連

```bash
# 開発サーバー起動（ライブリロード付き）
bundle exec jekyll serve

# プロダクション用ビルド
bundle exec jekyll build

# 変更監視付きビルド
bundle exec jekyll build --watch

# Jekyll設定の確認
bundle exec jekyll doctor
```

### Docker関連

```bash
# Jekyll開発サーバー起動
docker-compose up jekyll

# Pythonスクリプト実行
docker-compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python scripts/fetch_and_summarize.py
"
```

### テスト実行

```bash
# 全テストをカバレッジ付きで実行（Docker）
docker-compose run --rm python-scripts sh -c "
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
├── _config.yml              # Jekyll設定ファイル
├── Gemfile                  # Ruby依存関係
├── docker-compose.yml       # Docker開発環境設定
├── Dockerfile              # Jekyll開発環境
├── Dockerfile.production   # プロダクション環境
├── _layouts/               # Jekyllテンプレート
├── _includes/              # 再利用可能コンポーネント
├── _posts/                 # ブログ記事（Markdown）
├── assets/css/             # カスタムCSS
├── scripts/                # 自動化スクリプト
│   └── fetch_and_summarize.py
├── tests/                  # ユニットテスト
├── requirements.txt        # Python依存関係
└── .github/workflows/      # CI/CD設定
```

## 📝 記事の作成

記事は `_posts/` ディレクトリに以下の形式で作成してください：

```markdown
---
layout: post
title: "記事タイトル"
date: 2024-01-01 12:00:00 +0900
excerpt: "記事の要約"
---

記事の内容をここに記述...
```

## 🤖 自動化機能

### はてなブックマーク要約

`scripts/fetch_and_summarize.py` スクリプトは以下の機能を提供します：

1. **RSS処理**: はてなブックマークのRSSフィードを取得
2. **コンテンツ抽出**: BeautifulSoupを使用した記事内容の抽出
3. **AI要約**: Gemini APIを使用した3-5文の要約生成
4. **Markdown生成**: Jekyll互換の記事ファイル生成

### 環境変数

```bash
# Gemini API キー（GitHub Actions用）
GEMINI_API_KEY=your_api_key_here
```

## 🚀 デプロイ

GitHub Pagesを使用した自動デプロイが設定されています：

1. `main` ブランチへのプッシュ
2. GitHub ActionsでJekyllビルド実行
3. GitHub Pagesへの自動デプロイ

## 🎨 カスタマイズ

### カラーパレット

- **プライマリ**: #2c3e50（ダークブルーグレー）
- **アクセント**: #3498db（ブルー）
- **背景**: #fafafa（ライトグレー）

### フォント

日本語対応フォントスタックを使用：
- Helvetica Neue
- Hiragino Sans
- メイリオ
- sans-serif

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。