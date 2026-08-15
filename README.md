# Workmate AG-UI CodeZip Direct

既存UIを維持しながら、BFFとデータベースを外し、ブラウザからAmazon Bedrock AgentCore Runtimeへ直接接続する最小構成です。RuntimeはNode.js 22のCodeZipです。

> **このリポジトリは研究・学習用途のサンプルであり、プロダクションレディではありません。**
> AgentCore RuntimeへのブラウザからのAG-UI直接接続を検証することが目的です。
> レート制限、WAF、セキュリティレスポンスヘッダー、アクセスログ、監査証跡を実装していません。
> また、Microsoft Entra IDとのSSO連携パターンは実機検証を行っていません。
> そのまま業務利用しないでください。詳細は[既知の制約とセキュリティ上の注意](#既知の制約とセキュリティ上の注意)を参照してください。

## 構成

```text
Browser
  -> CloudFront -> private S3 (React / Vite)
  -> Cognito User Pool (email/password)
     -> optional: Microsoft Entra ID (OIDC)
  -> AgentCore Runtime (Bearer JWT / AG-UI SSE)
       -> Bedrock models

CloudFormation / CDK
  -> private S3 for CodeZip
  -> BucketDeployment uploads deployment_package.zip
  -> AWS::BedrockAgentCore::Runtime
```

含めないもの:

- BFF、Web Lambda、Lambda Function URL
- DynamoDB、PostgreSQL、RDS
- AgentCore Memoryや外部セッションストア
- 匿名ユーザー構成

CDKのS3デプロイ用カスタムリソースはCloudFormation実行時だけLambdaを使用します。アプリの通信経路にLambda/BFFはありません。

## UIと履歴

チャット、サイドバー、プロジェクト、設定、モデル選択などのUIは既存実装を踏襲しています。DBを持たないため、スレッドとプロジェクトは現在のブラウザタブ内だけの状態です。再読み込み後の履歴復元、プロジェクト分離メモリ、フィードバック保存は行いません。

## 必要環境

- WSL2 Ubuntu
- Node.js 24 / npm 11（Runtime成果物はNode.js 22対象）
- AWS CLI v2
- AWS CDK bootstrap済みの`us-east-1`
- Amazon Bedrockで使用モデルを利用可能なアカウント

Dockerは不要です。CodeZipと静的フロントエンドだけをビルドします。

## ローカル検証

```bash
npm ci
npm run verify
```

`public/runtime-config.json`は未デプロイ時に空値です。AWSの実値へフォールバックしないため、`npm run dev`だけでは認証画面を起動せず、設定不足を明示します。実画面のE2Eはデプロイ後に行います。

## 標準: Cognitoのみ

CDKは新しいUser Pool、public App Client、AWS提供Cognitoドメインを作ります。匿名アクセスはありません。ドメインプレフィックスを省略すると`workmate12-<AWS account ID>`を使用します。明示する場合は、他User Poolへ未割り当てのグローバルに一意な値を指定します。

AWSログイン後に実行します。

```powershell
aws login --profile admin
$env:AWS_PROFILE = "admin"
$env:AWS_REGION = "us-east-1"

npm run deploy -- -c cognitoDomainPrefix=<unique-domain-prefix>
```

デプロイ後、初期ユーザーと恒久パスワードを作ります。

```powershell
npm run cognito:user:create -- --email user@example.com --profile admin
```

スクリプトが表示するパスワードは安全な保管先へ移し、ターミナル履歴の取り扱いに注意してください。

### デプロイ済みフロントURLを確認する

CloudFormationのスタック出力からCloudFrontのURLを確認します。

```powershell
aws cloudformation describe-stacks `
  --stack-name WorkmateCodeZipStack `
  --profile admin `
  --region us-east-1 `
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationUrl'].OutputValue | [0]" `
  --output text
```

## オプション: Cognito + Microsoft Entra ID

> **このSSO連携パターンは実機検証を行っていません。**
> CDKのsynthとユニットテストでIdentity Providerリソースの生成までは確認していますが、
> 実際のEntraテナントを使ったログイン、AgentCore RuntimeへのJWT到達、属性マッピングの動作は未確認です。
> 以下の手順はそのまま動作することを保証しません。

Entra連携はOIDC Authorization Code Flowです。CognitoがEntraのconfidential Web clientとなり、ブラウザはCognitoのpublic App ClientをPKCEで利用します。Microsoft Graph APIをアプリから呼ばないため、Entraスコープは`openid email`だけです。

### 1. Entraアプリを作る

Entraアプリを作成するPowerShellスクリプトを`scripts/entra`へ同梱しています。

```powershell
$domainPrefix = "<unique-domain-prefix>"
$cognitoHost = "$domainPrefix.auth.us-east-1.amazoncognito.com"

$created = & ".\scripts\entra\New-EntraCognitoOidcApplication.ps1" `
  -TenantId "<Entra tenant GUID>" `
  -DisplayName "workmate-codezip" `
  -CognitoUserPoolDomainHost $cognitoHost
```

作成されるEnterprise Applicationはユーザー割り当て必須・My Apps非表示です。Entraへ登録するRedirect URIは次だけです。

```text
https://<unique-domain-prefix>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

### 2. クライアントシークレットをSecrets Managerへ保存する

Entraが一度だけ返す`$created.ClientSecret`を、例として`workmate12/entra/client-secret`へ保存します。リポジトリ、CDKコンテキスト、CloudFormationパラメータへシークレット本文を書かないでください。AWS Consoleまたは承認済みの秘密登録手順を使用します。

### 3. Entraオプションでデプロイする

```powershell
npm run deploy -- `
  -c cognitoDomainPrefix=$domainPrefix `
  -c entraEnabled=true `
  -c entraTenantId="<Entra tenant GUID>" `
  -c entraClientId=$created.ApplicationClientId `
  -c entraClientSecretName="workmate12/entra/client-secret"
```

`entraTenantId`、`entraClientId`、`entraClientSecretName`のいずれかが欠けるとCDK synthは停止します。標準のCognitoメール/パスワードログインも同時に有効なままです。

## CDKで作る主なリソース

- Cognito User Pool / App Client / Cognito domain
- オプションのEntra OIDC Identity Provider
- 非公開Web S3バケット / CloudFront OAC Distribution
- 非公開CodeZip S3バケット / BucketDeployment
- AgentCore Runtime実行ロール
- AgentCore CodeZip Runtime（AGUI、Cognito JWT authorizer）

`RuntimeArtifactsBucketName`をCloudFormation outputへ出すため、CDKが作成したS3へZIPが投入されたことを確認できます。

## 削除

このサンプルのS3、User Pool、Runtimeは`DESTROY`方針です。必要なデータがないことを確認してから実行します。

```powershell
npm run destroy -- -c cognitoDomainPrefix=<deployed-domain-prefix>
```

EntraアプリとSecrets Manager secretはこのCDKスタック外です。Entraオプションを使った場合は、`scripts/entra`の運用スクリプトと組織の秘密管理手順で別途削除・ローテーションします。

## 既知の制約とセキュリティ上の注意

研究・学習用途のサンプルとして、次を理解した上で使用してください。

### 認証境界は機能している

CloudFrontの公開URLを第三者が見つけても、次は成立しません。

- AgentCore Runtimeは`customJwtAuthorizer`で保護され、Cognitoが発行し`allowedClients`に一致するJWTがなければAWS側で拒否されます。**未認証でのBedrock呼び出しはできません**
- `selfSignUpEnabled: false`のため、アカウントの自己登録はできません
- パスワードは12文字以上で大文字・小文字・数字・記号が必須です
- `preventUserExistenceErrors`が有効なため、ユーザー列挙ができません

`runtime-config.json`は公開され、User Pool IDとApp Client IDが誰でも読めます。これらはpublic App Clientの仕様上そもそも秘密情報ではなく、SPAである以上隠蔽できません。

### 未実装の防御

| 項目 | 内容 | 想定される影響 |
|---|---|---|
| セキュリティレスポンスヘッダー | CSP、X-Frame-Options、HSTS、X-Content-Type-Optionsが未設定 | ログイン済みユーザーに対するクリックジャッキングが成立する。XSSが生じた場合の多層防御がない |
| レート制限・使用量上限 | Runtimeにレート制限がなく、WAFも未設定 | 認証済みユーザー1人がBedrockを無制限に呼び出せる。クライアントの不具合や連投で課金が膨らむ |
| 認証フロー | `USER_PASSWORD_AUTH`が有効。Amplifyは既定でSRPを使うため実際には不要 | 総当たりに使いやすい認証経路が余分に開いている |
| リダイレクトURL | 本番App Clientのcallback/logout URLに`http://localhost:5173/`が含まれる | 開発用リダイレクト先が本番クライアントに残る |
| トークン保管 | JWTはAmplifyの既定で`localStorage`に保存される | XSSが生じた場合にトークンが露出する。httpOnly Cookieにするには本構成が排除したBFFが必要 |
| ログ・監査 | CloudFrontとS3のアクセスログが未設定 | インシデント発生時に追跡できない |
| エラー表示 | ログイン失敗時にCognitoの原文メッセージをそのまま表示する | 内部エラー文言が利用者に見える |

### 検証範囲

- **Microsoft Entra IDとのSSO連携は実機検証を行っていません。** CDKのsynthとユニットテストでIdentity Providerリソースの生成までは確認していますが、実テナントでのログイン、AgentCore RuntimeへのJWT到達、属性マッピングの動作は未確認です
- テストは設定とユーティリティ層のみです。UIコンポーネントテストとE2Eテストはありません
- 実画面の動作確認はデプロイ後の手動確認を前提としています

## 既知の不具合

### Claude Sonnet 5はアカウントによって実行を拒否される

モデル選択肢に`Claude Sonnet 5`を含めていますが、AWSアカウントによっては実行時に次のエラーになります。

```text
AccessDeniedException: anthropic.claude-sonnet-5 is not available for this account.
You can explore other available models on Amazon Bedrock.
For additional access options, contact AWS Sales.
```

2026-08-16時点の検証では、対象アカウントで次がすべて満たされていてもこのエラーが発生しました。

- `GetFoundationModelAvailability`が`agreementAvailability=AVAILABLE`、`authorizationStatus=AUTHORIZED`、`entitlementAvailability=AVAILABLE`、`regionAvailability=AVAILABLE`
- Anthropic First Time Use（FTU）用途フォーム登録済み
- Runtime実行ロールに推論プロファイルARNと基盤モデルARNの両方を許可済み
- US Geo Inference Profile（`us.anthropic.claude-sonnet-5`）を指定

`thinking`と`output_config`を含まない最小のConverseリクエストでも、BedrockコンソールのPlaygroundからUS Geo Inference Profileを選んだ場合でも同じ結果でした。したがってリクエスト形式、Agreement、FTU用途フォーム、IAM、Inference Profileのいずれでも説明できません。状態APIに現れないアカウント単位の提供制限が適用されています。

回避策はSonnet 5以外のモデルを選ぶことです。解消にはAWS SalesまたはAWS Supportへの問い合わせが必要で、その際はリージョン、モデルID`anthropic.claude-sonnet-5`、Inference Profile ID`us.anthropic.claude-sonnet-5`、発生日時を伝えます。

この症状をAgentCore Runtimeの障害や`thinking`設定の不整合と取り違えないでください。`GetFoundationModelAvailability`の結果だけではSonnet 5を選択可能と判定できません。

## ライセンス

このリポジトリのコードはMIT Licenseです。[LICENSE](LICENSE)を参照してください。

同梱するNoto Sans JP（`@fontsource-variable/noto-sans-jp`）はSIL Open Font License 1.1です。フォント自体を再配布する場合はOFL-1.1の条件が適用されます。その他の依存はMIT、Apache-2.0、ISC、BSDのいずれかで、MITでの再配布を妨げるものはありません。
