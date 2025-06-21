#!/bin/bash

# n8n Docker Setup Script
# This script helps you set up n8n with Docker Compose

set -e

echo "🚀 n8n Docker セットアップスクリプト"
echo "=================================="

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker がインストールされていません。"
    echo "   https://docs.docker.com/get-docker/ からインストールしてください。"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose がインストールされていません。"
    echo "   https://docs.docker.com/compose/install/ からインストールしてください。"
    exit 1
fi

echo "✅ Docker と Docker Compose が利用可能です。"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 .env ファイルが見つかりません。テンプレートから作成します..."
    cp .env.example .env
    echo "✅ .env ファイルを作成しました。"
    echo "⚠️  重要: .env ファイルを編集して、適切なパスワードと設定を入力してください。"
    echo ""
    
    # Generate secure passwords
    echo "🔐 セキュアなパスワードを生成中..."
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    N8N_DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    N8N_AUTH_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    
    # Update .env file with generated passwords
    sed -i.bak "s/your_strong_postgres_password_here/$POSTGRES_PASSWORD/" .env
    sed -i.bak "s/your_strong_n8n_db_password_here/$N8N_DB_PASSWORD/" .env
    sed -i.bak "s/your_strong_n8n_password_here/$N8N_AUTH_PASSWORD/" .env
    rm .env.bak
    
    echo "✅ セキュアなパスワードを生成して設定しました。"
    echo ""
else
    echo "✅ .env ファイルが見つかりました。"
fi

# Create necessary directories
echo "📁 必要なディレクトリを作成中..."
mkdir -p ssl
mkdir -p ../workflows
echo "✅ ディレクトリを作成しました。"

# Prompt for basic configuration
echo ""
echo "🔧 基本設定を入力してください:"
echo ""

read -p "GitHub ユーザー名を入力してください: " GITHUB_OWNER
read -p "GitHub リポジトリ名を入力してください [claude-code-blog-site]: " GITHUB_REPO
GITHUB_REPO=${GITHUB_REPO:-claude-code-blog-site}

# Update .env file with user input
sed -i.bak "s/your_github_username/$GITHUB_OWNER/" .env
sed -i.bak "s/claude-code-blog-site/$GITHUB_REPO/" .env
rm .env.bak

echo ""
echo "🐳 Docker Compose でサービスを開始します..."

# Start services
docker-compose up -d

echo ""
echo "⏳ サービスの起動を待機中..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ n8n が正常に起動しました！"
    echo ""
    echo "🌐 アクセス情報:"
    echo "   URL: http://localhost:5678"
    echo "   ユーザー名: admin"
    echo "   パスワード: .env ファイルの N8N_BASIC_AUTH_PASSWORD を確認"
    echo ""
    echo "📋 次のステップ:"
    echo "   1. ブラウザで http://localhost:5678 にアクセス"
    echo "   2. 管理画面にログイン"
    echo "   3. GitHub Personal Access Token を設定"
    echo "   4. ワークフローをインポート"
    echo ""
    echo "📚 詳細な設定方法は README.md を参照してください。"
else
    echo "❌ サービスの起動に失敗しました。"
    echo "   ログを確認してください: docker-compose logs"
fi

echo ""
echo "🎉 セットアップが完了しました！"