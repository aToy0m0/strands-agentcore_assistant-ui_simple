# セキュリティ上の注意と既知の制約

`Workmate AG-UI CodeZip Direct` を利用・改変する前に読んでください。
プロジェクトの概要は[README](../README.md)、デプロイ手順は[デプロイ手順書](./deployment-guide.md)を参照してください。

研究・学習用途のサンプルとして、次を理解した上で使用してください。

## 認証境界は機能している

CloudFrontの公開URLを第三者が見つけても、次は成立しません。

- AgentCore Runtimeは`customJwtAuthorizer`で保護され、Cognitoが発行し`allowedClients`に一致するJWTがなければAWS側で拒否されます。**未認証でのBedrock呼び出しはできません**
- `selfSignUpEnabled: false`のため、アカウントの自己登録はできません
- パスワードは12文字以上で大文字・小文字・数字・記号が必須です
- `preventUserExistenceErrors`が有効なため、ユーザー列挙ができません

`runtime-config.json`は公開され、User Pool IDとApp Client IDが誰でも読めます。これらはpublic App Clientの仕様上そもそも秘密情報ではなく、SPAである以上隠蔽できません。

## 未実装の防御

| 項目 | 内容 | 想定される影響 |
|---|---|---|
| セキュリティレスポンスヘッダー | CSP、X-Frame-Options、HSTS、X-Content-Type-Optionsが未設定 | ログイン済みユーザーに対するクリックジャッキングが成立する。XSSが生じた場合の多層防御がない |
| レート制限・使用量上限 | Runtimeにレート制限がなく、WAFも未設定 | 認証済みユーザー1人がBedrockを無制限に呼び出せる。クライアントの不具合や連投で課金が膨らむ |
| リフレッシュトークン | 有効期間が30日と長い | 端末が侵害された場合の再利用可能期間が長い |
| リダイレクトURL | 本番App Clientのcallback/logout URLに`http://localhost:5173/`が含まれる | 開発用リダイレクト先が本番クライアントに残る |
| トークン保管 | JWTはAmplifyの既定で`localStorage`に保存される | XSSが生じた場合にトークンが露出する。httpOnly Cookieにするには本構成が排除したBFFが必要 |
| ログ・監査 | CloudFrontとS3のアクセスログが未設定。Runtimeのログは既定でモデルの入出力本文を含む | CloudFront/S3側はインシデント発生時に追跡できない。Runtime側は利用者の入力がCloudWatch Logsへ残る |
| エラー表示 | ログイン失敗時にCognitoの原文メッセージをそのまま表示する | 内部エラー文言が利用者に見える |

## 検証範囲

- **Microsoft Entra IDとのSSO連携は2026-08-16に実テナントで疎通確認済みです。** Identity Providerの作成、テナント全体の管理者同意、Entra経由のログイン、AgentCore RuntimeへのJWT到達（ツール実行を含む応答完了）まで確認しました。確認は管理者アカウント1件のみで、複数ユーザーやグループ割り当て下での動作は未確認です
- Entra経由のログインでは、ユーザー情報の取得に`fetchUserAttributes`（Cognitoの`GetUser`API）を使えません。アクセストークンに`aws.cognito.signin.user.admin`スコープが必要ですが、Hosted UIのAuthorization Code FlowではApp Clientに許可したスコープ（`openid email profile`）しか付与されないためです。現在はIDトークンのクレームから表示名を組み立てています（`src/lib/current-user.ts`）
- 管理者以外の一般ユーザーによるログインは未確認です。手順2の管理者同意とユーザー割り当てを両方済ませる必要があります
- テストは設定とユーティリティ層のみです。UIコンポーネントテストとE2Eテストはありません
- 実画面の動作確認はデプロイ後の手動確認を前提としています


## 関連ドキュメント

脅威モデル（STRIDE）、実装済みのセキュリティ統制、責任分界、データ分類、リスク評価は[セキュリティドキュメント](../SECURITY.md)にまとめています。
