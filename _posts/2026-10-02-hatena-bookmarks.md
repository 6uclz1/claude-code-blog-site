---
title: はてなブックマーク 2026年10月02日 の記事まとめ (2件)
date: 2026-10-02 09:00:00 +0900
permalink: /2026/10/02/hatena-bookmarks/
excerpt: 2026年10月02日にブックマークした2件を、1行ずつまとめました。
---

## [dotfiles を AI agent のために作り変えた](https://tellme.tokyo/post/2026/10/01/ai-agent-first-dotfiles/)

AIエージェントのターミナル利用が主流になったため、人間向け設定をopt-inとするdotfilesに再構築。

- is_human関数でTTYとAI環境変数を判定し、人間を識別。
- AIが期待するコマンド動作に合わせ、エイリアスやツールを調整。
- AI向けにシェル起動を高速化し、スナップショットを軽量化。

## [12GB VRAMで125Bモデルを動かす「Strata」の概要｜npaka](https://note.com/npaka/n/n4a1185074686)

Strataは、GPU・CPU・RAM・SSDを連携させ、12GB VRAMなどの一般的なPC環境で125B級のMoEモデルを動かすAI推論エンジン。

- モデル全体をVRAMに読み込まず、各リソースへ分散配置
- 頻繁に使うExpertをVRAMにキャッシュし処理を高速化
- 投機的デコードにより推論速度を約1.6〜1.8倍向上

---

*はてなブックマークのRSSから自動生成しています。要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*
