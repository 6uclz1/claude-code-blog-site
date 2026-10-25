---
title: はてなブックマーク 2026年10月24日 の記事まとめ (13件)
date: 2026-10-24 09:00:00 +0900
permalink: /2026/10/24/hatena-bookmarks/
excerpt: 2026年10月24日にブックマークした13件を、1行ずつまとめました。
---

## [GitHub - Lakr233/AssppWeb](https://github.com/Lakr233/AssppWeb)

App Store外のiOSアプリをWeb経由で取得・インストールするツール。ゼロトラスト設計でApple ID認証情報をサーバーに送らず、ブラウザで直接処理。

- Apple ID認証情報はブラウザで直接処理、サーバーは関与せず
- 公式インスタンスなし、悪意あるフロントエンドに注意
- Docker、Cloudflare Workers、Railwayでデプロイ可能

## [【快挙】任天堂・宮本茂氏が「文化勲章」を受章、ゲーム関係者としては初。“ゲームが文化になった50年”についても触れる会見の質疑応答を詳細に掲載](https://news.denfaminicogamer.jp/interview/261023n)

任天堂の宮本茂氏がゲーム関係者として初の文化勲章を受章。50年のゲーム制作を振り返り、ゲームが文化として社会に浸透した意義を語る会見内容。

- 文化勲章は「大勢の人たちと作った結果の代表」
- 「ゲームが文化になった」とは「ゲームが当たり前になった」こと
- マリオの最大の発明は「クッパと戦わないこと」

## [VocaTab](https://wavtechyukky.github.io/vocatab/ui/)

VocaTabは、Webブラウザで動作する歌声合成ツール。複数の歌声ライブラリ、声質調整、エフェクト機能を搭載し、手軽にボーカルを作成可能。

- 「波音リツ」など複数の歌声ライブラリを選択可能
- 音量、ブレス、フォルマントなど声質を細かく調整
- イコライザー、コンプレッサー、リバーブを適用可能

## [GitHub Actions workflow lockfiles in public preview - GitHub Changelog](https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/)

GitHub Actionsのワークフロー依存関係ロックファイルがパブリックプレビューに。タグやブランチの移動による予期せぬコード実行を防ぎ、セキュリティと一貫性を向上させる新機能。

- 専用CLI拡張機能でロックファイルを生成・管理
- 依存関係を特定のコミットに固定し、実行の一貫性を確保
- Dependabotがロックファイルの更新も自動化

## [Claude Code の「無駄」を可視化するツール cclens を作った](https://zenn.dev/lambdalisue/articles/introduce-cclens)

Claude Codeの非効率な設定や無駄な操作を、普段使いのログから計測・可視化し最適化を支援するCLIツール「cclens」の紹介。

- AI設定の効果検証は困難、パフォーマンスチューニングに類似。
- 普段のログ解析で時間・トークン・労力の無駄を可視化。
- 無駄のリストアップとAIによる最適化提案が可能。

## [PHPの緊急脆弱性「php2shell」で攻撃されていないか？サーバーに残る3つの痕跡と確認方法 - インフラ学習サイト「InfraAcademy」](https://engineer-ninaritai.com/php2shell-attack-detection/)

「php2shell」脆弱性による攻撃の有無を、アクセスログ、PHPエラーログ、Webサーバープロセスに残る3つの痕跡から確認する手順。

- 調査期間は脆弱性公開の4日前（10/17）からパッチ適用まで。
- 異常なフォーム送信や「Unknown on line 0」のメモリ不足エラーをログで確認。
- Webサーバーの子プロセスとして不審なシェルが動いていないか監視。

## [PHP2Shellへの対応を振り返って - コドモン Product Team Blog](https://tech.codmon.com/entry/2026/10/23/173909)

コドモンがPHPの重大脆弱性PHP2Shellへの予防的対応として、修正版公開前の情報拡散を受けサービスを一時停止し、その判断と復旧までの経緯を時系列で振り返る記録

- 深刻度9.2/10のPHP重大脆弱性「PHP2Shell」
- 修正版公開前の情報拡散を受け予防的にサービス停止
- 脆弱性把握から主要サービス再開まで約18時間で対応

## [Using Claude to reduce the attack surface of code](https://www.anthropic.com/research/attack-surface-reduction)

ClaudeのようなAIモデルを活用し、ソフトウェアの攻撃対象領域を自動で分析・削減することで、未知の脆弱性に対する防御力を高め、セキュリティを向上させる手法。

- 個別の脆弱性修正より、コード全体の到達性を制限し深刻度を低減
- Claudeが25のオープンソースプロジェクトで493の問題を発見
- 不要なコードを認証後や明示的オプトインに移動させアクセスを制限

## [Node2Shell: Node.js Brotli vulnerability allows remote code execution (CVE-2026-111497) and the fix](https://www.aikido.dev/blog/node2shell-nodejs-brotli-rce-cve-2026-111497)

Node.jsのBrotliデータ解凍処理にリモートコード実行を許す脆弱性Node2Shell (CVE-2026-111497)が発見され、修正版が公開

- Node.jsまたはBunを使用し、Brotliデータを解凍するアプリが対象
- Node.jsは22.23.4、24.22.1、26.12.1へ、Bunは1.4.4以降…
- Brotli圧縮リクエストの受信、fetch()によるBrotliレスポンス解凍などで発生

## [エージェントを使い続けるためのメタワーク / Meta-work for keeping using the agent](https://speakerdeck.com/rkaga/meta-work-for-keeping-using-the-agent)

AIエージェントを現場で継続的に活用するための、運用や改善を指すメタワークの解説資料

## [LLMs are making formal software verification feasible at a much larger scale](https://www.anthropic.com/research/formal-verification)

LLMの活用により、大規模な形式的ソフトウェア検証が実現可能となり、コードのセキュリティ保証を確立。

- ClaudeがRISC-Vアセンブリレベルで100以上のOSSを検証
- 検証過程で長年未発見のバグも発見
- 従来は専門家が長期間要し、実用困難だった

## [Fixing Critical Node & PHP Flaws | Devin](https://devin.ai/blog/vulnerability-fixes-plugin)

PHPとNode.jsにリモートコード実行を許すクリティカルな脆弱性が発見され、修正版がリリース。迅速なパッチ適用と、バージョン確認時の注意が必要な状況。

- PHPの脆弱性「PHP2Shell」は認証なしでリモートコード実行可能。
- php -vでは修正が確認できない場合あり、ベンダー情報を要確認。
- コンテナやCIなど、全てのデプロイメントで更新とテストが必要。

## [GitHub - anthropics/sandbox-runtime: A lightweight sandboxing tool for enforcing filesystem and network restrictions on arbitrary processes at the OS level, without requiring a container.](https://github.com/anthropics/sandbox-runtime)

コンテナ不要でOSレベルのファイルシステムやネットワーク制限を任意のプロセスに適用する軽量サンドボックスツール。

- OSネイティブ機能でファイル・ネットワークを制限
- コンテナ不要で任意のプロセスを隔離
- AIエージェントのセキュリティ強化に貢献

---

*はてなブックマークのRSSから自動生成しています。要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*
