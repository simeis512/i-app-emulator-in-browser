# i-app-emulator-in-browser

iアプリ（DoJa）をブラウザで動かすための実験的なエミュレーターです。
FreeJ2ME-Plus を基盤とし、CheerpJ 上で実行します。任意で openDoJa 由来の
ソフトウェア OpenGL ES 描画を使用できます。

**ゲーム本体・端末ダンプ・復元した保存データ・ゲーム素材は含みません。**
利用者が手元の JAR / JAM / SP をファイル選択で読み込む方式です。
互換性は限定的で、すべての iアプリの動作を保証するものではありません。

## 起動

ビルドには **JDK 17 以上**（`java` と `javac`）、**Python 3.10 以上**が必要です。
通常実行に Node.js は不要です。ビルド用の依存 Java ソースは同梱しています。
ビルドは外部ライブラリをダウンロードしません。

```sh
git clone https://github.com/simeis512/i-app-emulator-in-browser.git
cd i-app-emulator-in-browser
python build.py
python build_ogl.py
python serve.py
```

`http://127.0.0.1:9052/` を開きます。Windows ではビルド後に
`Start-Emulator.cmd` で起動、`Stop-Emulator.cmd` でローカルサーバーを停止できます。
Python が PATH にない場合は `Start-Emulator.ps1 -PythonExe "Pythonのパス"` を使用します。
macOS / Linux では環境に応じて `python` を `python3` に読み替えてください。

ブラウザでの実行には CheerpJ の公式 CDN への接続が必要です。
初回起動は時間がかかります。`index.html` を直接開く `file://` 起動には対応しません。
動作検証は Windows の Chromium 系ブラウザで行っています。

## アプリを読み込む

1. 対応する **JAR と JAM** を選びます。SP がある場合は一緒に選ぶか、後から追加します。
2. 画面サイズを選びます。通常は「2D」、OpenGL ES を使うアプリは「3D」を選びます。
3. 「起動する」を押します。

JAM は Shift_JIS として読み、`AppClass` と `SPsize` を使用します。
JAR / JAM は必須です。JAR だけからの設定推測、ZIP 一括読み込み、端末ダンプの解析・復号は行いません。
JAR / SP は約 64 MiB、JAM は 256 KiB、スクラッチパッドは合計 64 MiB・16 領域までです。
ファイル名の大文字・小文字やベース名の一致は問いません。

SP は JAM の `SPsize` を合計した長さの生データ、または 64 バイトヘッダー付きの形式を扱います。
SP を省略すると空の領域を作成します。SP に追加の画像・音楽などを保持するアプリは、
空の領域では起動できないことがあります。別アプリの SP を組み合わせないでください。

| 操作 | キー |
| --- | --- |
| 方向 | 矢印キー |
| 決定 | Enter / Space |
| 左・右ソフトキー | Z / X |
| テンキー | 0〜9、`*`、`#` |

画面上のボタンでも操作できます。横持ちアプリではキーの方向が異なる場合があります。
アプリ切り替え・再起動はページを再読み込みして、ファイルを選び直します。

## 保存とファイルの扱い

- 読み込んだ JAR / JAM / SP はブラウザ内の実行環境へ渡します。ファイルをサーバーへアップロードする機能はありません。
- 保存は CheerpJ の `/files`（ブラウザの IndexedDB）に保持します。JAR と JAM の内容の SHA-256 を組み合わせてアプリを識別します。
- **同じアプリの保存が既にある場合、選択した SP よりブラウザ内の保存を優先します。** SP の再選択で保存を上書きする機能はありません。
- 「SPを書き出す」で現在のスクラッチパッドを連結したヘッダーなし SP を保存できます。元の入力ファイルは変更しません。
- ブラウザ・プロファイル・接続先のホスト名やポートが変わると保存領域が変わります。サイトデータ削除やプライベートモード終了で失われる場合があるため、必要な SP は書き出してください。
- SP 書き出しはスクラッチパッドのみです。端末状態や任意の Java ファイル・RMS 全体を移行するものではありません。アプリが保存した後に書き出してください。

Java コードを実行するため、信頼できるアプリを使用してください。保存先の分離は整理のためで、
アプリ同士を隔離するセキュリティ境界ではありません。ホスティング時は専用のオリジンを使用してください。
CheerpJ の取得には外部通信が発生します。アプリ向け通信 API の非対応は、ネットワーク遮断を保証するものではありません。

## 現在の対応範囲

| 項目 | 状態 |
| --- | --- |
| DoJa の起動・Canvas・キー入力 | 一部対応。DoJa 5.1 設定で動作 |
| スクラッチパッド | 生 SP / ヘッダー付き SP、ブラウザ保存、SP 書き出し |
| 音楽イベント | 無音で進行するタイマーと同期・終了イベントの一部 |
| 音声出力 | 未対応 |
| OpenGL ES | 実験的なソフトウェア描画。色マスク・三角形のフォグなどを実装 |
| 多重テクスチャ・反射・拡張 API | 制限あり。未対応処理はログまたは例外で通知 |
| 通信・認証・配信サーバー依存 | 未対応 |
| 端末固有機能・iアプリDX・完全な MIDP 互換 | 検証・実装は不十分 |

3D は低速です。2D は Java 8、3D は Java 17 の CheerpJ 環境を使用します。
JavaScript から Java へのキー入力・状態取得・保存処理は共通の待ち行列で実行します。
本リポジトリで再現できるブラウザテストは、独自作成の小さなテストアプリによるものです。
商用ゲームをテストや配布物に含めていません。

## テスト

ビルド後に実行します。Node.js 20 以上が必要です。

```sh
python dependencies.py
python notices.py --check
python check.py
python -m unittest discover -s tests -p "test_*.py"
node --test tests/loader.test.mjs
python public_audit.py
```

任意のブラウザ統合テスト（CDN 接続が必要）:

```sh
python tests/build_fixture.py
npm ci
npx playwright install chromium
python serve.py
# 別のターミナルで
npm run test:browser
```

`tests/TestIappli.java` は本プロジェクト独自のテストコードです。
生成した JAR / JAM / SP は `build/fixture/` に置かれ、Git や配布 ZIP には入りません。
ブラウザテストは別プロファイルで描画・入力・SP ダウンロード・保存復元・Java 17 起動を確認します。
`TEST_URL` で接続先、`BROWSER_CHANNEL=msedge` などで既存ブラウザを指定できます。

## 配布とライセンス

組み合わせたエミュレーターは **GPL v3** で配布します。独自の変更部分は GPL-3.0-or-later、
各依存ソースは元のライセンスを保持します。詳細は [THIRD_PARTY.md](THIRD_PARTY.md)、
[NOTICE.txt](NOTICE.txt)、[LICENSE](LICENSE) を参照してください。
CheerpJ は別ライセンスの外部実行環境で、このリポジトリでは再配布しません。
利用・公開の際は [CheerpJ の現在の利用条件](https://cheerpj.com/docs/licensing)を確認してください。

```sh
python package.py
```

公開対象の許可リストと依存ソースを検査し、両 JAR を再ビルドして
`dist/i-app-emulator-in-browser.zip` を作成します。
ZIP にはビルドスクリプト・依存ソース・ライセンスを含め、`web/source.zip` から
その配布版に対応するソースを取得できるようにします。ゲームや個人の保存は含みません。
`public_audit.py --tracked` は Git の登録対象も許可リストと照合します。

静的サイトとして配布する場合は ZIP 内の **`web/` 全体**を HTTPS で配置し、
`source.zip` も同じ場所で取得できるようにしてください。HTTP Range リクエストへの対応を推奨します。
このリポジトリの CI は検証と配布 ZIP の生成までで、サイトへの自動デプロイは行いません。

## 構成

- `src/` — ブラウザ橋渡し、無音の音楽イベント処理
- `src-ogl/` — フォグ補助処理
- `web/` — ファイル選択・描画・操作 UI
- `build.py` / `build_ogl.py` — 原本を変更せず、ビルド用コピーに修正を適用
- `vendor/` / `UPSTREAM.json` — 固定した上流ソースとハッシュ
- `tests/` — 自作データだけで動作する検証

不具合報告にはブラウザ・描画モード・画面サイズ・再現手順・必要部分の実行ログを添えてください。
ゲームの JAR、素材、個人の保存データはリポジトリや Issue に添付しないでください。
