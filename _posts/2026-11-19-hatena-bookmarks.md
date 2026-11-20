---
title: はてなブックマーク 2026年11月19日 の記事まとめ (3件)
date: 2026-11-19 09:00:00 +0900
permalink: /2026/11/19/hatena-bookmarks/
excerpt: 2026年11月19日にブックマークした3件を、1行ずつまとめました。
---

## [ソフトウェアダークファクトリー | 技術評論社](https://gihyo.jp/book/2026/978-4-297-16073-9)

AIコーディングのリスクに対し、人間の判断や知識をシステムに埋め込み、AIが安全に変更を生み出し続ける開発環境を構築する新しいソフトウェアアーキテクチャ。

- AIの雑な実装でも壊れ方を機械的に検出・制御するガードレール設計。
- DDDや型システムなど古典・現代工学手法をAI制御の仕組みとして再構築。
- あいまいな仕様、弱い権限設計、薄いテスト、壊れやすい運用リスクに対応。

## [External sandboxes for coding agents](https://simonwillison.net/2026/Nov/17/external-sandboxes-for-coding-agents/)

コーディングエージェントのコード実行を安全に行うため、エージェント本体と分離した外部サンドボックスパターンを提案、その実装例を公開

- 誤操作やプロンプトインジェクション攻撃からシステムを保護
- v86、Apple Containers、Quicksandを用いた実装例を公開
- HTTP/HTTPS許可リストや認証情報置換機能も搭載

## [Unauthenticated Remote Code Execution in NGINX: CVE-2026-123633 and CVE-2026-123007 | Wiz Blog](https://www.wiz.io/blog/nginx-http2-rce-vulnerabilities)

NGINXに認証不要なリモートコード実行の重大な脆弱性2件が発見、HTTP/2有効環境でサーバー乗っ取りやデータ窃盗の危険性。

- NGINX自体に脆弱性があり、アプリケーションコードの安全は無関係
- HTTP/2が有効なNGINXサーバーが影響対象
- 年以降の広範囲なバージョンに影響、修正版の適用を推奨

---

*はてなブックマークのRSSから自動生成しています。要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*
