# Docker n8n セルフホスト環境

このディレクトリには、n8nをDockerでセルフホストするための設定ファイルが含まれています。

## 📋 必要要件

- Docker 20.10+
- Docker Compose 2.0+
- 最低 2GB RAM
- 最低 5GB ディスク容量

## 🚀 クイックスタート

### 1. 自動セットアップ（推奨）

```bash
cd docker
./setup.sh
```

セットアップスクリプトが以下を自動実行します：
- 環境設定ファイルの作成
- セキュアなパスワードの生成
- 必要なディレクトリの作成
- Docker Compose でのサービス起動

### 2. 手動セットアップ

```bash
# 1. 環境設定ファイルをコピー
cp .env.example .env

# 2. .env ファイルを編集（パスワードなど）
nano .env

# 3. サービスを起動
docker-compose up -d

# 4. ログを確認
docker-compose logs -f
```

## 🏗️ アーキテクチャ

このセットアップには以下のサービスが含まれます：

### コアサービス

- **n8n**: メインアプリケーション（ポート: 5678）
- **PostgreSQL**: データベース（永続化）
- **Redis**: キューとキャッシュ
- **Nginx**: リバースプロキシ（ポート: 80/443）

### データ永続化

- `postgres_data`: PostgreSQLデータ
- `redis_data`: Redisデータ
- `n8n_data`: n8n設定とワークフローデータ

## 🔧 設定オプション

### 環境変数（.envファイル）

#### データベース設定
```env
POSTGRES_DB=n8n
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_strong_password
POSTGRES_NON_ROOT_USER=n8n
POSTGRES_NON_ROOT_PASSWORD=your_n8n_password
```

#### n8n基本設定
```env
N8N_HOST=localhost
N8N_PORT=5678
N8N_PROTOCOL=http
WEBHOOK_URL=http://localhost:5678
```

#### 認証設定
```env
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=your_admin_password
```

#### GitHub連携
```env
GITHUB_OWNER=your_username
GITHUB_REPO=claude-code-blog-site
```

## 🌐 ネットワーク構成

### 開発環境
- n8n UI: http://localhost:5678
- Nginx: http://localhost:80

### プロダクション環境
- HTTPS対応（SSL証明書設定）
- カスタムドメイン設定
- セキュリティヘッダー

## 📁 ディレクトリ構造

```
docker/
├── docker-compose.yml     # Docker Compose設定
├── .env.example          # 環境変数テンプレート
├── .env                  # 環境変数（gitignore）
├── nginx.conf            # Nginx設定
├── init-data.sh          # データベース初期化
├── setup.sh              # 自動セットアップスクリプト
├── ssl/                  # SSL証明書（プロダクション用）
└── README.md             # このファイル
```

## 🔐 セキュリティ設定

### Basic認証
管理画面へのアクセスにBasic認証を使用：
- ユーザー名: `N8N_BASIC_AUTH_USER`
- パスワード: `N8N_BASIC_AUTH_PASSWORD`

### SSL/TLS（プロダクション推奨）

1. SSL証明書を `ssl/` ディレクトリに配置：
   ```
   ssl/
   ├── cert.pem
   └── key.pem
   ```

2. .envファイルでHTTPS設定を有効化：
   ```env
   N8N_PROTOCOL=https
   WEBHOOK_URL=https://your-domain.com
   ```

3. nginx.confのHTTPS設定のコメントアウトを解除

### ネットワークセキュリティ
- Rate limiting設定済み
- セキュリティヘッダー設定済み
- 内部ネットワーク分離

## 🚦 サービス管理

### 基本コマンド

```bash
# サービス起動
docker-compose up -d

# サービス停止
docker-compose down

# サービス再起動
docker-compose restart

# ログ確認
docker-compose logs -f [service_name]

# サービス状態確認
docker-compose ps

# リソース使用量確認
docker stats
```

### メンテナンス

```bash
# データベースバックアップ
docker-compose exec postgres pg_dump -U n8n n8n > backup.sql

# データベース復元
docker-compose exec -T postgres psql -U n8n n8n < backup.sql

# n8nデータバックアップ
docker-compose exec n8n tar czf /tmp/n8n-backup.tar.gz /home/node/.n8n
docker cp container_name:/tmp/n8n-backup.tar.gz ./n8n-backup.tar.gz
```

## 📊 モニタリング

### ヘルスチェック
- PostgreSQL: `docker-compose exec postgres pg_isready`
- Redis: `docker-compose exec redis redis-cli ping`
- n8n: http://localhost/health

### ログ監視
```bash
# 全サービスのログ
docker-compose logs -f

# 特定サービスのログ
docker-compose logs -f n8n
docker-compose logs -f postgres
docker-compose logs -f nginx
```

## 🔄 ワークフロー管理

### ワークフローのインポート

1. n8n管理画面にアクセス
2. 設定 → インポート/エクスポート
3. `../.n8n/workflows/` のJSONファイルをインポート

### 認証情報の設定

1. 設定 → 認証情報
2. GitHub APIトークンを設定
3. 必要に応じて他の認証情報も設定

## 🐛 トラブルシューティング

### よくある問題

#### 1. サービスが起動しない
```bash
# ログを確認
docker-compose logs

# ポートの競合チェック
netstat -tulpn | grep :5678
```

#### 2. データベース接続エラー
```bash
# PostgreSQLの状態確認
docker-compose exec postgres pg_isready -U n8n -d n8n

# 接続テスト
docker-compose exec n8n sh -c 'echo "SELECT 1" | psql -h postgres -U n8n -d n8n'
```

#### 3. パフォーマンス問題
```bash
# リソース使用量確認
docker stats

# メモリ制限の調整（docker-compose.yml）
services:
  n8n:
    deploy:
      resources:
        limits:
          memory: 1G
```

#### 4. ワークフローが実行されない
- Basic認証設定の確認
- GitHub webhookのURL確認
- 認証トークンの有効性確認

### ログ分析

```bash
# エラーログの抽出
docker-compose logs n8n 2>&1 | grep -i error

# 特定時間範囲のログ
docker-compose logs --since="2024-01-01T00:00:00" --until="2024-01-01T23:59:59"
```

## 🔄 アップデート

### n8nのアップデート

```bash
# 最新イメージを取得
docker-compose pull

# サービスを再作成
docker-compose up -d --force-recreate
```

### 設定の更新

```bash
# docker-compose.yml変更後
docker-compose up -d --force-recreate

# .env変更後
docker-compose down && docker-compose up -d
```

## 📚 参考資料

- [n8n Documentation](https://docs.n8n.io/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)