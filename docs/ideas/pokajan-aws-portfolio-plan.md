# ポカジャン AWS ポートフォリオ化 計画

## Context

ポカジャンを AWS に載せてポートフォリオにする。Cognito でユーザー認証、まずシングルプレイ
（CPU 対局）で公開し、マルチプレイ（対人戦）は**設計だけ用意して次段**に回す。

作業リポジトリは `~/workspace/claude_code/cc_aws_portfolio`（インフラ専用・別リポジトリ）を想定する。

### 確定方針（ユーザー確認済み）

| 論点 | 決定 |
| --- | --- |
| マルチプレイ | **まずシングルプレイ＋Cognito 認証**。対人戦は設計だけ用意し次段（GameLift は不採用の想定） |
| リポジトリ | **ゲームをコピーしない**。`cc_aws_portfolio` は**インフラ専用の別リポジトリ**。cc-pokajan 側には**S3 アップロードスクリプトを足すだけ** |
| 成果物 | **本計画書のみ**（Claude Code 実行用プロンプト一式と IaC 選定は次セッション） |

> **マルチプレイと GameLift について**: ポカジャンはターン制カードゲームで、GameLift は本来
> リアルタイム専用サーバ向け（ターン制には過剰でコスト・運用負荷が高い）。対人戦を実装する段では
> **API Gateway WebSocket + Lambda + DynamoDB** で決定的エンジンをサーバ権威として再利用する構成を想定する。

---

## モデル（ゲームをコピーしない・リポジトリ分離）

- **`cc_aws_portfolio`（新規・別リポジトリ）= インフラ専用**。ゲームコードは持たない。
- **`cc-pokajan`（現行）** には **`npm run deploy` 相当のアップロードスクリプトだけ**を足す
  （`vite build` → `aws s3 sync dist s3://<bucket>` → CloudFront 無効化）。バケット/ディストリビューション ID は
  env もしくは未追跡設定で注入。cc-pokajan への footprint はこれのみ。

---

## アーキテクチャ（Phase 1: シングルプレイ＋認証）

- **S3（非公開）**: 静的バンドル置き場。
- **CloudFront（OAC）**: HTTPS 配信 + SPA ルーティング。
- **Cognito User Pool + Hosted UI**: 認証。
- **エッジ認証ゲート（Lambda@Edge, cognito-at-edge パターン）**: CloudFront でログイン必須化。
  → **ゲームコードを一切触らずに「ログインしないと遊べない」を実現**（コピーせず方針に合致）。

### 認証の解釈（v1・要確認事項として明記）

v1 は**アクセスゲート**（ログイン必須）まで。アプリ内でのユーザー名表示・所持コインの
クラウド保存など**アプリ統合を伴う個人化は Phase 2**（DynamoDB + アプリ改修が必要）。
この線引きで「アップロードスクリプトぐらい」の footprint に収める。

---

## 段階ロードマップ

| Phase | 内容 | 主要素 |
| --- | --- | --- |
| 1 | 静的公開＋ログインゲート | S3 + CloudFront(OAC) + Cognito + Lambda@Edge。cc-pokajan に deploy スクリプト |
| 2 | 個人化（任意） | アプリに Cognito 統合、DynamoDB に所持コイン等を per-user 保存 |
| 3 | マルチプレイ（設計のみ今回） | API Gateway WebSocket + Lambda + DynamoDB、決定的エンジンをサーバ権威で再利用。GameLift は不採用想定 |

---

## IaC（今回は選定せず、選択肢を提示）

- **AWS CDK (TypeScript)** — フロントと言語統一・型安全・ポートフォリオ映え（第一候補）
- **Terraform** — `deploy-on-aws` プラグイン/CLAUDE.md の想定に合致

最終選定と Claude Code 実行用プロンプト一式（`/add-feature` コマンド）は**次セッション**で確定する。

---

## 未決事項

- 認証の深さ（v1 のアクセスゲートのみ / Phase 2 のアプリ統合までを今回スコープに含めるか）
- IaC ツールの最終選定（CDK / Terraform）
- リージョン（Cognito Hosted UI・Lambda@Edge の配置制約に留意。Lambda@Edge は us-east-1 必須）
- 独自ドメインの有無（ACM 証明書・Route 53 の要否）
- 概算コスト（S3 + CloudFront + Cognito は低トラフィックなら極小。Lambda@Edge の呼び出し課金に留意）

---

## 今回やらないこと（申し送り）

- マルチプレイ実装（設計記述のみ）。Cognito のアプリ内個人化（Phase 2）。
- IaC コード・`cc_aws_portfolio` リポジトリ作成・S3 への実デプロイ・Claude Code 用プロンプト一式（次セッション）。
- 実 AWS 認証を要する操作（デプロイ・`terraform plan`/`cdk deploy` 等）は本計画では実施しない。
