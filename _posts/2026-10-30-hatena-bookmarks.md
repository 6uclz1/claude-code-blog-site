---
title: はてなブックマーク 2026年10月30日 の記事まとめ (2件)
date: 2026-10-30 09:00:00 +0900
permalink: /2026/10/30/hatena-bookmarks/
excerpt: 2026年10月30日にブックマークした2件を、1行ずつまとめました。
---

## [GitHub Actions で checkout@v7 のようなバージョン指定を書くのはやめよう！ 時代は actions.lock！](https://zenn.dev/progate/articles/24b1140180300c)

GitHub Actionsのバージョン指定はセキュリティリスクを伴うため、コミットSHA固定や新機能actions.lockで安全に運用する重要性

- @v7のような指定は悪意あるバージョンへの改ざんリスク
- 過去にTrivy Actionで認証情報窃取を狙う改ざん事件が発生
- actions.lockは内部依存Actionも固定し安全性を強化

## [Trojanized Claude Code Extension Plants an SSH Backdoor](https://opensourcemalware.com/blog/trojanized-claude-code-extension-plants-persistent-ssh-backdoor)

Cursor MarketplaceのClaude Code拡張機能不正版が、ユーザーのSSH設定を改ざんし、永続的なバックドアを仕込むトロイの木馬として機能。

- 悪意あるコードは正規機能より先に実行。
- 拡張機能の読み込みだけでバックドアが有効化。
- ユーザーのSSH鍵追加とリバースシェル確立。

---

*はてなブックマークのRSSから自動生成しています。要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*
