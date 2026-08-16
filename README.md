# Workmate AG-UI CodeZip Direct

既存UIを維持しながら、BFFとデータベースを外し、ブラウザからAmazon Bedrock AgentCore Runtimeへ直接接続する最小構成です。RuntimeはNode.js 22のCodeZipです。

> **このリポジトリは研究・学習用途のサンプルであり、プロダクションレディではありません。**
> AgentCore RuntimeへのブラウザからのAG-UI直接接続を検証することが目的です。
> レート制限、WAF、セキュリティレスポンスヘッダー、アクセスログ、監査証跡を実装していません。
> Microsoft Entra IDとのSSO連携は実テナントで疎通まで確認済みですが、管理者アカウント1件での確認にとどまります。
> そのまま業務利用しないでください。詳細は[既知の制約とセキュリティ上の注意](#既知の制約とセキュリティ上の注意)を参照してください。

## 構成図

![システム構成図](doc/images/architecture.png)

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

## 手順書

ローカル検証、デプロイ、Microsoft Entra ID連携、削除の手順は[デプロイ手順書](doc/deployment-guide.md)にまとめています。

## CDKで作る主なリソース

- Cognito User Pool / App Client / Cognito domain
- オプションのEntra OIDC Identity Provider
- 非公開Web S3バケット / CloudFront OAC Distribution
- 非公開CodeZip S3バケット / BucketDeployment
- AgentCore Runtime実行ロール
- AgentCore CodeZip Runtime（AGUI、Cognito JWT authorizer）

`RuntimeArtifactsBucketName`をCloudFormation outputへ出すため、CDKが作成したS3へZIPが投入されたことを確認できます。

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

- **Microsoft Entra IDとのSSO連携は2026-08-16に実テナントで疎通確認済みです。** Identity Providerの作成、テナント全体の管理者同意、Entra経由のログイン、AgentCore RuntimeへのJWT到達（ツール実行を含む応答完了）まで確認しました。確認は管理者アカウント1件のみで、複数ユーザーやグループ割り当て下での動作は未確認です
- Entra経由のログインでは、ユーザー情報の取得に`fetchUserAttributes`（Cognitoの`GetUser`API）を使えません。アクセストークンに`aws.cognito.signin.user.admin`スコープが必要ですが、Hosted UIのAuthorization Code FlowではApp Clientに許可したスコープ（`openid email profile`）しか付与されないためです。現在はIDトークンのクレームから表示名を組み立てています（`src/lib/current-user.ts`）
- 管理者以外の一般ユーザーによるログインは未確認です。手順2の管理者同意とユーザー割り当てを両方済ませる必要があります
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

## 補足: PowerShellで`npm run`の引数がCDKへ渡らない場合

本READMEのコマンドは既定の`npm`を前提としています。通常はそのまま動作します。以下は、PowerShellで`npm`がラップされている環境に限って起きる問題への注記です。

safe-chainのような一部のツールは、PowerShellプロファイルで`npm`を**関数**として定義します。PowerShellは関数への引数束縛時に`--`を区切り記号として取り除くため、`npm run deploy -- -c key=value`と書いても`--`が消え、`-c`がnpm自身の`--call`オプションとして解釈されます。症状は2つあります。

- npmが`npm_config_call`を子プロセスへ伝播し、`cdk.json`の`npx tsx infrastructure/app.ts`が`npm error code EUSAGE`で失敗する
- `-c`を`--context`へ置き換えると、npmが`Unknown cli config`として黙って落とし、値だけが`cdk deploy`の位置引数として渡る。**エラーにならないまま、CDKコンテキストが適用されずにデプロイが完了する**

`Get-Command npm -All`で`Function`が現れる場合はこの状況です。回避するには`npm.cmd`を使います。関数ではなく実行ファイルとして解決されるため`--`が保持されます。つまり、各手順のコマンドの`npm`を`npm.cmd`に置き換えるだけです。

```powershell
# 引数が渡るかどうかの確認だけなら、変更を伴わないsynthで試せる
npm.cmd run cdk:synth -- -c cognitoDomainPrefix=$domainPrefix
```

> **`-c`を省略したデプロイは実行しないでください。**
> CDKコンテキストは前回値が保存されません。`entraEnabled=true`を付けずにデプロイすると`EntraIdentityProvider`がテンプレートから消え、**設定済みのEntra Identity Providerが削除されます**。
> Entra構成でデプロイするときは、必ず[デプロイ手順書の「Entraオプションでデプロイする」](doc/deployment-guide.md#4-entraオプションでデプロイする)のコンテキスト5個をすべて渡してください。

Bash（WSL2など）では`--`が保持されるため、この問題は起きません。

## ライセンス

このリポジトリのコードはMIT Licenseです。[LICENSE](LICENSE)を参照してください。

同梱するNoto Sans JP（`@fontsource-variable/noto-sans-jp`）はSIL Open Font License 1.1です。フォント自体を再配布する場合はOFL-1.1の条件が適用されます。その他の依存はMIT、Apache-2.0、ISC、BSDのいずれかで、MITでの再配布を妨げるものはありません。
