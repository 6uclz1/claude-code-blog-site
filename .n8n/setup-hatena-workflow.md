# はてなブックマークRSS自動ブログ更新ワークフロー設定ガイド

このドキュメントでは、はてなブックマークのRSSフィードを監視し、前日の記事を要約してブログに自動投稿するn8nワークフローの設定方法を説明します。

## 📋 事前準備

### 1. 必要なサービスとAPI

- **n8n環境**: Docker環境で動作するn8n
- **OpenAI API**: 記事要約用（GPT-3.5-turbo）
- **GitHub Personal Access Token**: リポジトリへの書き込み権限
- **はてなブックマークアカウント**: `Buchi_6uclz1`のRSSフィード

### 2. API キーとトークンの準備

#### OpenAI API キー
1. [OpenAI Platform](https://platform.openai.com/)にログイン
2. API Keysページで新しいキーを作成
3. 使用量制限を適切に設定

#### GitHub Personal Access Token
1. GitHub Settings → Developer settings → Personal access tokens
2. 以下のスコープを選択：
   - `repo` (フルアクセス)
   - `workflow` (GitHub Actionsアクセス)

## 🔧 n8n認証情報の設定

### 1. OpenAI API認証情報

n8n管理画面で以下を設定：

- **名前**: `openai-api-key`
- **タイプ**: OpenAI
- **API Key**: 取得したOpenAI APIキー

### 2. GitHub API認証情報

#### GitHub API Token
- **名前**: `github-api-token`
- **タイプ**: GitHub API
- **Access Token**: 取得したGitHub Personal Access Token

#### GitHub Header Auth（リクエスト用）
- **名前**: `github-header-auth`
- **タイプ**: Header Auth
- **ヘッダー名**: `Authorization`
- **値**: `token YOUR_GITHUB_TOKEN`

## 📁 ワークフローのインポート

### 1. ワークフローファイルの配置

```bash
# ワークフローファイルが以下の場所にあることを確認
.n8n/workflows/github-blog-auto-update.json
```

### 2. n8nでのインポート手順

1. n8n管理画面（http://localhost:5678）にアクセス
2. 「Workflows」→「Import from File」を選択
3. `github-blog-auto-update.json`をアップロード
4. インポート完了後、認証情報を設定

## 🚀 ワークフローの動作概要

### 実行スケジュール
- **実行時間**: 毎日 8:00 AM（日本時間）
- **実行頻度**: 1日1回

### 処理フロー

1. **RSSフィード取得**
   - URL: `https://b.hatena.ne.jp/Buchi_6uclz1/rss`
   - はてなブックマークのRSSを取得

2. **前日記事フィルタリング**
   - 前日（実行日の前日）に更新された記事のみを抽出
   - 記事がない場合は処理をスキップ

3. **記事コンテンツ取得**
   - 各記事のURLから本文コンテンツを取得
   - HTMLパースで本文を抽出

4. **AI要約生成**
   - OpenAI GPT-3.5-turboで記事を要約
   - 日本語で3-5つのポイントに整理

5. **Markdown記事生成**
   - Jekyll用のMarkdown形式で記事を作成
   - Front matter設定（タイトル、日付、カテゴリなど）

6. **GitHub投稿**
   - `_posts/`ディレクトリに記事ファイルを作成
   - GitHub Pages自動ビルドをトリガー

## 📝 生成される記事の形式

### ファイル名
```
YYYY-MM-DD-hatena-summary-[sanitized-title].md
```

### Markdown構造
```markdown
---
layout: post
title: "記事タイトル"
date: YYYY-MM-DD
excerpt: "はてなブックマークで注目された記事の要約です。"
categories: ["はてな要約"]
tags: ["はてなブックマーク", "要約", "自動生成"]
source_url: "元記事URL"
---

## 記事情報

- **元記事**: [記事タイトル](元記事URL)
- **要約日時**: YYYY年MM月DD日 HH:MM
- **情報源**: はてなブックマーク

## 要約

[OpenAIで生成された要約内容]

## 元記事リンク

詳細については、[こちらの元記事](元記事URL)をご覧ください。

---

*この記事は、はてなブックマークのRSSフィードから自動生成された要約です。*
```

## ⚙️ カスタマイズ設定

### 1. 実行時間の変更

`Daily 8:00 AM`ノードで時間を変更：
```json
{
  "triggerTimes": {
    "item": [
      {
        "hour": 9,  // 9時に変更
        "minute": 30  // 30分に変更
      }
    ]
  }
}
```

### 2. RSS URLの変更

`Get Hatena RSS Feed`ノードでURLを変更：
```json
{
  "url": "https://b.hatena.ne.jp/OTHER_USER/rss"
}
```

### 3. 要約プロンプトのカスタマイズ

`Summarize with OpenAI`ノードのプロンプト変更：
```
あなたの要求に応じたカスタムプロンプト...
記事内容: {{$json["cleanContent"]}}
```

### 4. 出力カテゴリとタグの変更

`Generate Markdown Post`ノードのカテゴリ・タグ設定：
```javascript
categories: ["技術", "ニュース"]
tags: ["AI", "要約", "自動化"]
```

## 🔍 トラブルシューティング

### よくある問題

#### 1. RSS取得エラー
```bash
# 手動でRSSフィードを確認
curl "https://b.hatena.ne.jp/Buchi_6uclz1/rss"
```

#### 2. OpenAI API制限
- API使用量の確認
- レート制限の調整
- プロンプトの最適化

#### 3. GitHub API エラー
- Personal Access Tokenの有効性確認
- リポジトリの権限確認
- ファイルパスの確認

#### 4. 記事が生成されない
- 前日のはてなブックマーク活動確認
- フィルタリング条件の確認
- ログ出力での詳細確認

### ログ確認

```bash
# n8nログの確認
docker-compose logs -f n8n

# 特定実行のログ確認
# n8n管理画面 → Executions → 実行履歴
```

## 📊 監視とメンテナンス

### 定期チェック項目

1. **API使用量監視**
   - OpenAI API使用量
   - GitHub API制限

2. **実行状況確認**
   - 毎日の実行成功/失敗
   - エラーログの確認

3. **記事品質確認**
   - 要約の精度
   - Markdown形式の正確性

### メンテナンス作業

- 月次：API使用量レビュー
- 週次：生成記事の品質確認
- 日次：実行ログの確認

## 🔒 セキュリティ考慮事項

1. **API キーの管理**
   - 定期的なローテーション
   - 最小権限の原則

2. **アクセス制御**
   - n8n管理画面のBasic認証
   - HTTPS通信の確保

3. **監査ログ**
   - 実行履歴の記録
   - 異常な活動の監視

## 📚 参考リンク

- [n8n Documentation](https://docs.n8n.io/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [GitHub API Documentation](https://docs.github.com/en/rest)
- [はてなブックマークRSS](https://b.hatena.ne.jp/help/entry/rss)