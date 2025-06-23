---
layout: post
title: "はてなブックマーク記事まとめ - 2025年06月23日"
date: 2025-06-23 09:00:00 +0900
excerpt: "これらの記事は、Reactの最新技術や開発ツール、AIエージェントの効率的な活用法、そして企業における「捨てる会議」を通じた非効率の排除といった多様な側面から、IT分野における「効率化」と「変化への適応」という共通のテーマを扱っています。

- [来たるべき 8.0 に備えて React 19 新機能と React Router 固有機能の取捨選択とすり合わせを考える](https://speakerdeck.com/oukayuka/lai-tarubeki-8-dot-0-nibei-ete-react-19-xin-ji-neng-to-react-router-gu-you-ji-neng-noqu-she-xuan-ze-tosurihe-wasewokao-eru)


- [Claude Code 逆引きコマンド事典](https://zenn.dev/ml_bear/articles/84e92429698177)


- [藤田晋『「捨てる会議」で捨てたもの』](https://ameblo.jp/shibuya/entry-12037994877.html)


- [Ink を使って CLI アプリを React で書く](https://azukiazusa.dev/blog/ink-cli-app/)

"
---

昨日のはてなブックマークから気になった記事をAIで要約してお届けします。


## 1. 来たるべき 8.0 に備えて React 19 新機能と React Router 固有機能の取捨選択とすり合わせを考える

**URL:** [https://speakerdeck.com/oukayuka/lai-tarubeki-8-dot-0-nibei-ete-react-19-xin-ji-neng-to-react-router-gu-you-ji-neng-noqu-she-xuan-ze-tosurihe-wasewokao-eru](https://speakerdeck.com/oukayuka/lai-tarubeki-8-dot-0-nibei-ete-react-19-xin-ji-neng-to-react-router-gu-you-ji-neng-noqu-she-xuan-ze-tosurihe-wasewokao-eru)

**要約:**
本記事は、来るべきReact 19の時代を見据え、React RouterがReact Server Components (RSC) にどのように対応していくかを考察しています。React Router 7系では、`loader()`や`action()`からRSCを返せるようになるほか、Server Componentを直接ルーティングに組み込む「Server Component Routes」が導入される予定です。

これにより、サーバーサイドのロジックやコンポーネントをReactアプリケーションにシームレスに統合し、パフォーマンス向上や開発効率化が期待されます。開発者は`"use client"`や`"use server"`といったディレクティブを適切に使い分け、クライアントとサーバー間の境界を明確にしながら、これらの新しい機能群を効果的に活用していくことが求められるでしょう。

---

## 2. Claude Code 逆引きコマンド事典

**URL:** [https://zenn.dev/ml_bear/articles/84e92429698177](https://zenn.dev/ml_bear/articles/84e92429698177)

**要約:**
この記事は、AnthropicのAIエージェント「Claude Code」を効率的に利用するための『逆引きコマンド事典』です。説明書を読まないユーザー向けに、途切れた会話を再開する`claude -c`や過去のスレッドに戻る`claude -r`、単発質問の`claude -p`など、具体的な困りごとへの解決策を提示しています。

また、ファイルの内容を渡す`@ファイル名`やシェルコマンドを実行する`!`、Claudeの実行停止（ESC）や会話リセット（`/clear`）といった操作方法も解説されています。特に、特定のファイル編集やGit操作を制限する`/permissions`など、Claudeの振る舞いを細かく制御する設定についても触れられており、開発作業の効率化と安全な利用をサポートします。

---

## 3. 藤田晋『「捨てる会議」で捨てたもの』

**URL:** [https://ameblo.jp/shibuya/entry-12037994877.html](https://ameblo.jp/shibuya/entry-12037994877.html)

**要約:**
サイバーエージェントの藤田晋社長は、企業が新事業を次々生み出す中で、時代に合わなくなったものや効果が薄れたものを整理するため、初の試みとなる「捨てる会議」を実施したと報告しています。この会議のテーマは「破壊と再生」で、非効率な慣習や機能しない制度、利用率の低い施設などをゼロベースで見直すことが目的でした。

会議の結果、「ジギョつく」といった事業創出プログラムやエンジニア日報の強制、旧態依然としたアメブロの「ペタ」機能など、多岐にわたる32項目が廃止または見直しの対象となりました。藤田氏は、この取り組みが会社全体のデトックスとなり、惰性で続けていたものを改めて見直す良い機会になったと述べています。これにより、企業は常に変化に対応し、新たな価値を創造していく姿勢を強調しました。

---

## 4. Ink を使って CLI アプリを React で書く

**URL:** [https://azukiazusa.dev/blog/ink-cli-app/](https://azukiazusa.dev/blog/ink-cli-app/)

**要約:**
Inkは、Reactの知識を活かしてCLIアプリケーションのユーザーインターフェースを構築できるライブラリです。FlexboxベースのYogaレイアウトエンジンを採用しているため、Web開発と同様にCSSライクなスタイルでターミナルUIをデザインできます。Reactの基本的なコンポーネントや`useState`、`useEffect`といったフックも利用可能で、Webアプリ開発と同様のアプローチでインタラクティブなCLIアプリを作成できます。記事では、簡単な「Hello, world!」から始まり、Vercel AI SDKと連携してAIモデルとチャットする実用的なアプリケーションを構築する手順が紹介されており、より高度なCLIツール開発への応用も示唆されています。

---


*このまとめは、はてなブックマークのRSSフィードから自動生成されました。*
*要約はAI（Gemini）によって生成されており、元記事の内容を正確に反映していない場合があります。*
