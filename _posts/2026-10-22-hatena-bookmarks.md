---
title: はてなブックマーク 2026年10月22日 の記事まとめ (6件)
date: 2026-10-22 09:00:00 +0900
permalink: /2026/10/22/hatena-bookmarks/
excerpt: 2026年10月22日にブックマークした6件を、1行ずつまとめました。
---

## [エージェントスキル集 pstack の開発原則と使い方](https://azukiazusa.dev/blog/pstack-agent-skills/)

pstackは、AI生成コードの品質向上を目指すエージェントスキル集であり、実装前の理解、小さな変更、動作での検証といった開発原則に基づき、高品質なコード生成を支援するツール。

- 既存コードの動作をhowスキルで調査し理解を深める
- architectスキルで型や境界を設計し複数の案を比較
- 完了はコンパイル成功でなく実際の動作で証明する

## [内製 Background Coding Agent “haro” で拓く未来の開発体験 - LayerX エンジニアブログ](https://tech.layerx.co.jp/entry/why-we-built-our-background-agent)

LayerXが大規模monorepo開発の課題解決と開発体験最適化のため、内製クラウド型Coding Agent「haro」を開発。PRの過半数をharo経由で生成し、開発効率を大幅に向上させ、エンジニア以外の利用も促進。

- ローカル開発の限界と既製品の不足が内製動機。
- 社内サービスや内製ツールと連携し開発体験を最適化。
- PRの55%以上をharoが生成、デザイナーやQAも活用。

## [GitHub - openai/php2shell-checker](https://github.com/openai/php2shell-checker)

OpenAI製のPHPバージョンチェッカーは、ウェブサイトやローカル環境のPHPヘッダー情報から潜在的な脆弱性のあるバージョンを検出・警告するツール

- PHP 5.4-8.1系はパッチ適用済みでも脆弱性警告対象
- HTTPヘッダー情報からPHPバージョンを検出・判定
- バックポート修正や実際のインストール状況は確認不可

## [Linuxカーネルに6件の脆弱性「Infinity Core」、5件でroot権限昇格・コンテナ脱出のPoC公開(CVE-2026-98260,CVE-2026-98256)他|セキュリティニュースのセキュリティ対策Lab](https://rocket-boys.co.jp/security-measures-lab/linux%E3%82%AB%E3%83%BC%E3%83%8D%E3%83%AB%E3%81%AB6%E4%BB%B6%E3%81%AE%E8%84%86%E5%BC%B1%E6%80%A7%E3%80%8Cinfinity-core%E3%80%8D%E3%80%815%E4%BB%B6%E3%81%A7root%E6%A8%A9%E9%99%90%E6%98%87%E6%A0%BC/)

Linuxカーネルに「Infinity Core」と称する6件の脆弱性が公開。5件でroot権限昇格やコンテナ脱出のPoCが示され、修正版への更新が推奨。

- 件の脆弱性でroot権限昇格やコンテナ脱出のPoC公開。
- 悪用にはローカルでのコード実行が前提条件。
- 修正済み安定版への速やかな更新が推奨。

## [PHP 8.5.12の緊急リリースにpixivはどう対応したか - pixiv inside](https://inside.pixiv.blog/2026/10/22/193321)

PHP緊急脆弱性対応で、pixivがKubernetes環境への移行後初のバージョンアップを約30分で迅速に完了させた事例。

- 公式イメージを待たず自前ビルドできる経路を事前準備。
- 高性能CI基盤とDockerfile最適化で6分フルビルド。
- Kubernetesへの高速デプロイと一括解除スクリプト活用。

## [GitHub CLI: Opt in to expiring, auto-refreshing OAuth tokens - GitHub Changelog](https://github.blog/changelog/2026-10-21-github-cli-opt-in-to-expiring-auto-refreshing-oauth-tokens/)

GitHub CLI、有効期限付き自動更新OAuthトークンを導入。再認証不要でセキュリティ向上、`--expiring`フラグでオプトイン可能。

- 再認証なしで認証状態を維持、利便性向上
- 漏洩トークンは数時間で無効化、セキュリティ強化
- Git連携には`gh auth setup-git`設定を推奨

---

*はてなブックマークのRSSから自動生成しています。要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*
