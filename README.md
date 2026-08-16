# Workmate AG-UI CodeZip Direct

既存UIを維持しながら、BFFとデータベースを外し、ブラウザからAmazon Bedrock AgentCore Runtimeへ直接接続する最小構成です。RuntimeはNode.js 22のCodeZipです。

> **このリポジトリは研究・学習用途のサンプルであり、プロダクションレディではありません。**
> AgentCore RuntimeへのブラウザからのAG-UI直接接続を検証することが目的です。
> レート制限、WAF、セキュリティレスポンスヘッダー、アクセスログ、監査証跡を実装していません。
> Microsoft Entra IDとのSSO連携は実テナントで疎通まで確認済みですが、管理者アカウント1件での確認にとどまります。
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

`<unique-domain-prefix>`の決め方と空き確認は[プレースホルダの確認方法](#プレースホルダの確認方法)を参照してください。

デプロイ後、初期ユーザーと恒久パスワードを作ります。

```powershell
npm run cognito:user:create -- --email user@example.com --profile admin
```

`user@example.com`は作成したい初期ユーザーのメールアドレスです。Cognito側の検証済み属性として登録されるだけで、実際にメールは送信されません。

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

> **このSSO連携は2026-08-16に実テナントで疎通確認済みです。**
> Identity Providerの作成、テナント全体の管理者同意、Entra経由のログイン、
> AgentCore RuntimeへのJWT到達（ツール実行を含む応答完了）までを確認しました。
> ただし確認は管理者アカウント1件のみです。一般ユーザーでのログインと、
> 複数ユーザー・グループ割り当て下での動作は未確認です。

Entra連携はOIDC Authorization Code Flowです。CognitoがEntraのconfidential Web clientとなり、ブラウザはCognitoのpublic App ClientをPKCEで利用します。Microsoft Graph APIをアプリから呼ばないため、Entraスコープは`openid email`だけです。

### 0. Microsoft Graphへ一度だけ接続する

以降の手順で繰り返し使う値を、先に変数へ入れておきます。**`<...>`の部分は実際の値に置き換えてください。**そのまま実行すると`Invalid tenant id provided.`のようなエラーになります。値の調べ方は[プレースホルダの確認方法](#プレースホルダの確認方法)を参照してください。

```powershell
$tenantId = "<Entra tenant GUID>"
$appDisplayName = "workmate-codezip"
$domainPrefix = "<unique-domain-prefix>"
```

`scripts/entra`のスクリプトは、既存のMicrosoft Graphセッションがあればそれを再利用します。手順の最初に一度接続しておけば、スクリプトを実行するたびにブラウザ認証を求められることはありません。

```powershell
Connect-MgGraph -TenantId $tenantId -Scopes 'Application.ReadWrite.All','Application.Read.All','DelegatedPermissionGrant.ReadWrite.All' -ContextScope Process -NoWelcome
```

指定するスコープは`scripts/entra`配下のスクリプトが要求するものの和集合です。不足したまま実行すると、Graph呼び出しが失敗する前にスクリプトが不足スコープ名を挙げて停止します。

接続状態は次で確認できます。

```powershell
Get-MgContext | Select-Object TenantId, Account, Scopes
```

Entraの手順（0から2）が終わったら切断します。

```powershell
Disconnect-MgGraph
```

事前に接続しなかった場合、各スクリプトは自分で接続し、終了時に自分で切断します。その場合は実行のたびに認証が必要になります。

### 1. Entraアプリを作る

まずMicrosoft Entra管理センター（<https://entra.microsoft.com>）へ管理者でログインし、**アプリ登録の表示名を決めて控えておきます**。以降のスクリプトとポータル操作はこの名前でアプリを特定します。本READMEでは`workmate-codezip`を例に使います。

Cognitoのドメインホストが必要なので、先にスタック出力を確認します。

```powershell
aws cloudformation describe-stacks --stack-name WorkmateCodeZipStack --region us-east-1 --query "Stacks[0].Outputs" --output table 
```

作成方法は2通りあります。どちらか一方だけを実行してください。

#### 方法A: スクリプトで作成する

アプリ登録、サービスプリンシパル、クライアントシークレットをまとめて作ります。

```powershell
$cognitoHost = "$domainPrefix.auth.us-east-1.amazoncognito.com"

$created = & ".\scripts\entra\New-EntraCognitoOidcApplication.ps1" `
  -TenantId $tenantId `
  -DisplayName $appDisplayName `
  -CognitoUserPoolDomainHost $cognitoHost
```

作成されるEnterprise Applicationはユーザー割り当て必須・My Apps非表示です。

#### 方法B: Entra管理センターで手動作成する

1. Entra管理センターへログインし、「アプリの登録」→「新規登録」を開く
2. 「名前」に手順0で`$appDisplayName`へ入れた表示名（例: `workmate-codezip`）を入力する
3. 「サポートされているアカウントの種類」で「この組織ディレクトリのみに含まれるアカウント（単一テナント）」を選ぶ
4. 「リダイレクトURI」でプラットフォームに「Web」を選び、下記のURIを入力する
5. 登録後、「概要」に表示される**アプリケーション (クライアント) ID**を控える
6. 「証明書とシークレット」→「新しいクライアントシークレット」を作成し、**表示された値を控える**。この値は再表示できない

```text
https://<unique-domain-prefix>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

Entraへ登録するRedirect URIはこの1つだけです。ポータルへ貼り付ける実際の値は次で表示できます。

```powershell
"https://$domainPrefix.auth.us-east-1.amazoncognito.com/oauth2/idpresponse"
```

手動で作成した場合、`New-EntraCognitoOidcApplication.ps1`は同名アプリを検出して`An application with the same displayName already exists`で停止します。方法Bを選んだときはこのスクリプトを実行せず、次の2つで設定を揃えてください。

```powershell
$appClientId = "<application client ID>"

& ".\scripts\entra\Set-EntraCognitoOidcApiPermissions.ps1" `
  -TenantId $tenantId `
  -ApplicationClientId $appClientId

& ".\scripts\entra\Set-EntraCognitoEnterpriseApplicationProperties.ps1" `
  -TenantId $tenantId `
  -ApplicationClientId $appClientId
```

前者はAPIのアクセス許可を`openid`と`email`だけに揃え、後者はEnterprise Applicationをユーザー割り当て必須・My Apps非表示にします。

方法Bでは`$created`変数が存在しないため、以降の手順に出てくる`$($created.ApplicationClientId)`と`$($created.ClientSecret)`は、控えた値へ読み替えてください。

### 2. 管理者の同意をテナント全体へ与える

`New-EntraCognitoOidcApplication.ps1`と`Set-EntraCognitoOidcApiPermissions.ps1`は、Microsoft Graphの委任スコープ`openid`と`email`を**要求として登録するだけ**です。同意そのものは与えません。ポータルの「API のアクセス許可」には「付与されていません」と表示されたままになります。

この状態で一般ユーザーがログインすると、次のいずれかになります。

- 利用者ごとに同意画面が表示される
- テナントで「ユーザーの同意を許可しない」を設定している場合、同意画面すら出せずログインが失敗する

Enterprise Applicationへユーザーを割り当てても、この同意は代替できません。割り当ては「誰がこのアプリを使えるか」の制御であり、同意は「アプリがどの情報を読めるか」の許可だからです。したがって、管理者が事前にテナント全体の同意を与えておきます。

```powershell
# 方法Aで作成した場合。方法Bなら $appClientId をそのまま使う
$appClientId = $created.ApplicationClientId

$consent = & ".\scripts\entra\Grant-EntraCognitoOidcAdminConsent.ps1" `
  -TenantId $tenantId `
  -ApplicationClientId $appClientId
```

スクリプトはMicrosoft Graphの`oauth2PermissionGrants`へ`consentType: AllPrincipals`の付与を作成します。既に同じ付与がある場合はスコープを`openid email`へ更新します。付与後に再取得して、スコープが一致することを検証します。

実行には**Cloud Application Administrator以上のロール**が必要です。要求するGraphスコープは`Application.Read.All`と`DelegatedPermissionGrant.ReadWrite.All`です。

現在の同意状態だけを確認したい場合は`-WhatIf`を付けます。変更は行わず、`Phase = Before`の内容だけが出力されます。

```powershell
& ".\scripts\entra\Grant-EntraCognitoOidcAdminConsent.ps1" `
  -TenantId $tenantId `
  -ApplicationClientId $appClientId `
  -WhatIf
```

`GrantedScopes`に`openid`と`email`が並べば完了です。ポータル側では「API のアクセス許可」の状態が「<テナント名> に付与されました」に変わります。

なお`New-EntraCognitoOidcApplication.ps1`が作るEnterprise Applicationはユーザー割り当て必須です。同意とは別に、ログインさせたい利用者を「エンタープライズ アプリケーション」→対象アプリ→「ユーザーとグループ」で割り当ててください。両方が揃って初めて一般ユーザーがログインできます。

### 3. クライアントシークレットをSecrets Managerへ保存する

Entraが一度だけ返す`$created.ClientSecret`を、例として`workmate12/entra/client-secret`へ保存します。リポジトリ、CDKコンテキスト、CloudFormationパラメータへシークレット本文を書かないでください。AWS Consoleまたは承認済みの秘密登録手順を使用します。

初回登録（シークレットが未作成の場合）:

```powershell
aws secretsmanager create-secret --name "workmate12/entra/client-secret" --secret-string $($created.ClientSecret) --profile admin --region us-east-1
```

既に同名のシークレットが存在する場合（再作成や更新時）:

```powershell
aws secretsmanager put-secret-value --secret-id "workmate12/entra/client-secret" --secret-string $($created.ClientSecret) --profile admin --region us-east-1
```

`$created.ClientSecret`ではなく`$($created.ClientSecret)`と書く点に注意してください。PowerShellの引数モードでは`$created`だけが展開され、`.ClientSecret`はリテラルとして残ります。

このシークレット登録を先に完了させてから手順4のデプロイを実行してください。デプロイ時、CDKは`SecretValue.secretsManager(clientSecretName)`でこのシークレットをCloudFormation dynamic referenceとして参照するため、未登録のままデプロイするとスタック更新が失敗します。

### 4. Entraオプションでデプロイする

```powershell
npm run deploy -- `
  -c cognitoDomainPrefix=$domainPrefix `
  -c entraEnabled=true `
  -c entraTenantId=$tenantId `
  -c entraClientId=$appClientId `
  -c entraClientSecretName="workmate12/entra/client-secret"
```

`entraTenantId`、`entraClientId`、`entraClientSecretName`のいずれかが欠けるとCDK synthは停止します。標準のCognitoメール/パスワードログインも同時に有効なままです。

ただし`entraEnabled`だけを省略した場合は停止しません。false扱いとなり、`EntraIdentityProvider`がテンプレートから消えて**既存のIdentity Providerが削除されます**。CDKコンテキストは前回値を保存しないため、**2回目以降のデプロイでも毎回この5個をすべて渡してください**。

### ログイン画面に出す認証手段を選ぶ

`loginMethods`コンテキストで、ログイン画面の表示を切り替えられます。

| 値 | ログイン画面の表示 |
|---|---|
| `cognito` | メールアドレスとパスワードの入力欄だけ |
| `entra` | 「Microsoftで続ける」ボタンだけ |
| `cognito-and-entra` | 両方（区切り線付き） |

省略した場合の既定は、`entraEnabled=true`なら`cognito-and-entra`、そうでなければ`cognito`です。これまでと同じ表示になります。

Entra SSOだけを見せる場合は次のようにします。

```powershell
npm run deploy -- `
  -c cognitoDomainPrefix=$domainPrefix `
  -c entraEnabled=true `
  -c entraTenantId=$tenantId `
  -c entraClientId=$appClientId `
  -c entraClientSecretName="workmate12/entra/client-secret" `
  -c loginMethods=entra
```

`entraEnabled=true`なしで`entra`や`cognito-and-entra`を指定すると、ログイン手段のない画面になるためsynthが停止します。未知の値も同様に停止します。

> **これは画面表示の制御であり、認証方式そのものを無効化するものではありません。**
> `loginMethods=entra`にしてもCognito App ClientのパスワードログインとHosted UIは有効なままです。
> パスワード認証を実際に塞ぐには、App Clientの`authFlows`と`supportedIdentityProviders`を変更する必要があります。

デプロイ後、Identity Providerが実際に作られたかを確認します。コンテキストが渡らなかった場合、スタック更新は成功したまま何も作られないため、この確認は省略しないでください。

```powershell
aws cognito-idp list-identity-providers --user-pool-id <UserPoolId> --max-results 10 --profile admin --region us-east-1
```

`Providers`に`ProviderName: MicrosoftEntraID`、`ProviderType: OIDC`が現れれば成功です。空配列`[]`の場合はコンテキストが届いていません。[補足: PowerShellで`npm run`の引数がCDKへ渡らない場合](#補足-powershellでnpm-runの引数がcdkへ渡らない場合)を確認してください。

## プレースホルダの確認方法

READMEに登場する`<...>`と`$created.*`の入手方法をまとめます。AWS側の値は`--profile admin --region us-east-1`を前提とします。

| プレースホルダ | 意味 | 確認元 |
|---|---|---|
| `<unique-domain-prefix>` | Cognitoドメインのプレフィックス | 自分で決める。省略時は`workmate12-<AWS account ID>` |
| `<deployed-domain-prefix>` | デプロイ済みのプレフィックス | スタック出力`CognitoDomain`の先頭ラベル |
| `<UserPoolId>` / `<UserPoolClientId>` | Cognito User PoolとApp ClientのID | スタック出力 |
| `user@example.com` | 作成する初期ユーザーのメールアドレス | 自分で決める |
| `<Entra tenant GUID>` | EntraテナントID | Entra管理センターまたはCLI |
| `$created.ApplicationClientId` | Entraアプリのクライアント ID | 手順1のスクリプトの戻り値 |
| `$created.ClientSecret` | Entraアプリのクライアントシークレット | 手順1のスクリプトの戻り値（一度きり） |
| `workmate12/entra/client-secret` | Secrets Managerのシークレット名 | 自分で決める |

### AWS側の値をまとめて確認する

デプロイ後はスタック出力にすべて揃っています。

```powershell
aws cloudformation describe-stacks --stack-name WorkmateCodeZipStack --profile admin --region us-east-1 --query "Stacks[0].Outputs" --output table
```

個別に取り出す場合は`OutputKey`を指定します。

```powershell
aws cloudformation describe-stacks --stack-name WorkmateCodeZipStack --profile admin --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]" --output text
```

`<deployed-domain-prefix>`は`CognitoDomain`（`<prefix>.auth.us-east-1.amazoncognito.com`）の先頭ラベルです。

### `<unique-domain-prefix>`を決める

Cognitoのドメインプレフィックスはリージョン内でグローバルに一意である必要があります。既定値に使うAWSアカウントIDは次で確認します。

```powershell
aws sts get-caller-identity --query Account --output text --profile admin
```

指定したい値が空いているかは次で確認します。エラーにならず`DomainDescription`が空オブジェクトなら未使用です。他User Poolが使用中の場合はUser Pool IDを含む内容が返ります。

```powershell
aws cognito-idp describe-user-pool-domain --domain <unique-domain-prefix> --profile admin --region us-east-1
```

### `<Entra tenant GUID>`を確認する

Microsoft Entra管理センター（<https://entra.microsoft.com>）の「概要」に表示されるテナントIDです。

コマンドで確認する場合、**追加インストールが不要なのは次の方法だけ**です。テナントの検証済みドメイン（`contoso.onmicrosoft.com`や独自ドメイン）からOpenID Connectのディスカバリ文書を引き、`issuer`に含まれるGUIDを取り出します。認証も不要です。

```powershell
$doc = Invoke-RestMethod "https://login.microsoftonline.com/<検証済みドメイン>/v2.0/.well-known/openid-configuration"
[regex]::Match($doc.issuer, '[0-9a-fA-F-]{36}').Value
```

Microsoft Graph PowerShell（`Microsoft.Graph.Authentication`モジュール）が入っている場合は、接続後のコンテキストからも読めます。

```powershell
Connect-MgGraph -Scopes 'Application.Read.All' -NoWelcome
Get-MgContext | Select-Object TenantId, Account
```

`(Get-MgContext).TenantId`が何も表示しない場合、`Get-MgContext`が`$null`を返しています。つまり有効なセッションがありません。まず次で切り分けます。

```powershell
$null -eq (Get-MgContext)
```

`True`なら未接続です。`Connect-MgGraph`のサインインが完了していないか、`-ContextScope Process`で接続したセッションとは**別のPowerShellプロセス**で実行しています。`Process`スコープのコンテキストはそのウィンドウ限りで、閉じると失われます。

Azure CLIが入っている環境では次でも取得できますが、`az`は既定ではインストールされていません。使えない場合は上の方法を使ってください。

```powershell
az account show --query tenantId --output tsv
```

### `$created`の値を後から確認する

`$created`は手順1の`New-EntraCognitoOidcApplication.ps1`が返すオブジェクトです。同じPowerShellセッションを閉じると失われます。

`ApplicationClientId`はEntra管理センターの「アプリの登録」→対象アプリ→「アプリケーション (クライアント) ID」で確認できます。

コマンドで引く場合は、Microsoft Graphへ接続したうえで表示名から検索します。

```powershell
Connect-MgGraph -TenantId "<Entra tenant GUID>" -Scopes 'Application.Read.All' -ContextScope Process -NoWelcome

$filter = [Uri]::EscapeDataString("displayName eq '<アプリの表示名>'")
(Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/applications?`$filter=$filter&`$select=appId,displayName").value
```

Azure CLIが入っていれば次でも取得できます。`az`は既定ではインストールされていません。

```powershell
az ad app list --display-name "<アプリの表示名>" --query "[].appId" --output tsv
```

クライアントIDが分かっていれば、同梱スクリプトで登録内容全体を確認できます。

```powershell
& ".\scripts\entra\Get-EntraCognitoOidcApplication.ps1" `
  -TenantId "<Entra tenant GUID>" `
  -ApplicationClientId "<application client ID>"
```

`ClientSecret`はEntraが作成時に一度だけ返す値で、**後から参照できません**。紛失した場合は再発行します。発行後は手順3でSecrets Managerを更新し、再デプロイします。

```powershell
$rotated = & ".\scripts\entra\New-EntraCognitoOidcClientSecret.ps1" `
  -TenantId "<Entra tenant GUID>" `
  -ApplicationClientId "<application client ID>"
```

### Secrets Managerのシークレット名を確認する

```powershell
aws secretsmanager list-secrets --query "SecretList[].Name" --output table --profile admin --region us-east-1
```

登録済みかどうかだけを確かめる場合は次を使います。シークレット本文は表示されません。

```powershell
aws secretsmanager describe-secret --secret-id "workmate12/entra/client-secret" --query Name --output text --profile admin --region us-east-1
```

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

`<deployed-domain-prefix>`はデプロイ時に指定した値です。分からなくなった場合はスタック出力`CognitoDomain`の先頭ラベルから復元できます（[プレースホルダの確認方法](#プレースホルダの確認方法)を参照）。

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
> Entra構成でデプロイするときは、必ず[手順4](#4-entraオプションでデプロイする)のコンテキスト5個をすべて渡してください。

Bash（WSL2など）では`--`が保持されるため、この問題は起きません。

## ライセンス

このリポジトリのコードはMIT Licenseです。[LICENSE](LICENSE)を参照してください。

同梱するNoto Sans JP（`@fontsource-variable/noto-sans-jp`）はSIL Open Font License 1.1です。フォント自体を再配布する場合はOFL-1.1の条件が適用されます。その他の依存はMIT、Apache-2.0、ISC、BSDのいずれかで、MITでの再配布を妨げるものはありません。
