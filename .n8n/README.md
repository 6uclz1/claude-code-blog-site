# n8n ブログ自動化設定

このディレクトリには、GitHub Pagesブログの自動更新を行うn8nワークフローが含まれています。

## ワークフロー概要

### 1. blog-automation.json
GitHub Webhookを使用してブログの自動更新を行うワークフロー

**機能:**
- GitHubのmainブランチへのpushを検知
- リポジトリ情報の取得
- GitHub Pagesのビルドをトリガー
- 適切なレスポンスを返却

**トリガー:** GitHub Webhook (POST request)

### 2. auto-post-creation.json
定期的に新しいブログ投稿を自動作成するワークフロー

**機能:**
- 毎日午前9時に実行
- 既存の投稿をチェック
- 今日の投稿がない場合、新しい投稿を自動生成
- 投稿をGitHubリポジトリにコミット
- GitHub Pagesのビルドをトリガー

**トリガー:** Cron Schedule (毎日09:00)

## セットアップ手順

### 1. n8nインスタンスの準備

```bash
# n8nをインストール
npm install n8n -g

# n8nを起動
n8n start
```

### 2. 必要な認証情報の設定

n8nの管理画面で以下の認証情報を設定:

#### GitHub API Token
- **名前:** `github-token`
- **タイプ:** GitHub API
- **アクセストークン:** GitHubのPersonal Access Token
- **必要なスコープ:** `repo`, `workflow`

#### GitHub Header Auth
- **名前:** `github-header-auth`
- **タイプ:** Header Auth
- **名前:** `Authorization`
- **値:** `token YOUR_GITHUB_TOKEN`

### 3. 環境変数の設定

ワークフローで使用する環境変数:

```bash
export GITHUB_OWNER="your-github-username"
export GITHUB_REPO="claude-code-blog-site"
```

### 4. ワークフローのインポート

1. n8n管理画面にアクセス
2. 「Workflows」→「Import from File」を選択
3. `blog-automation.json` と `auto-post-creation.json` をインポート
4. 認証情報を正しく設定
5. ワークフローを有効化

### 5. GitHub Webhookの設定

1. GitHubリポジトリの「Settings」→「Webhooks」
2. 「Add webhook」をクリック
3. 以下を設定:
   - **Payload URL:** `https://your-n8n-instance.com/webhook/github-webhook`
   - **Content type:** `application/json`
   - **Events:** Push events
   - **Active:** チェック

## ワークフローの動作確認

### blog-automation.json
```bash
# mainブランチにpushしてテスト
git push origin main
```

### auto-post-creation.json
```bash
# 手動実行でテスト（n8n管理画面から）
# または時間を調整して動作確認
```

## トラブルシューティング

### よくある問題

1. **認証エラー**
   - GitHubトークンの権限を確認
   - トークンの有効期限を確認

2. **Webhook応答なし**
   - n8nインスタンスのURL確認
   - ファイアウォール設定確認

3. **自動投稿が作成されない**
   - 既存の投稿ファイル名の形式確認
   - 日付形式の確認（YYYY-MM-DD）

### ログの確認

n8nの実行履歴でエラー詳細を確認できます:
1. n8n管理画面の「Executions」タブ
2. 失敗した実行をクリック
3. エラーメッセージとデータを確認

## カスタマイズポイント

### 投稿テンプレートの変更
`auto-post-creation.json`の`postTemplates`配列を編集して、自動生成される投稿内容をカスタマイズできます。

### 実行スケジュールの変更
`Daily Schedule`ノードの`triggerTimes`を編集して、投稿作成時間を変更できます。

### 追加機能の実装
- 外部APIからコンテンツを取得
- 画像の自動生成・アップロード
- SNSへの自動投稿
- 投稿の品質チェック

## セキュリティ注意事項

- GitHubトークンは最小限の権限のみ付与
- Webhookエンドポイントにはレート制限を設定
- n8nインスタンスへのアクセスを制限
- 定期的なトークンのローテーション