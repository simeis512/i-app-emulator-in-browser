# 開発ルール

コードの置き場所、実装の進め方、ブランチ名・コミットメッセージ・PR の書き方を揃えるためのルールです。
公開してよいもの・してはいけないものの決まりは [AGENTS.md](AGENTS.md) の「守ること」が優先します。

- [コードの置き場所](#コードの置き場所)
- [ファイルの分け方](#ファイルの分け方)
- [書き方の約束](#書き方の約束)
- [実装の進め方](#実装の進め方)
- [ブランチ・コミット・PR](#ブランチコミットpr)

## コードの置き場所

```
src/p905i/web/   FreeJ2ME-Plus 側の追加クラス（Java 8、CheerpJ 8 で動く）
src-ogl/         openDoJa の 3D 描画への追加クラス（Java 17、CheerpJ 17 で動く）
web/             ブラウザ側の画面・入力・音・WebGL2
build.py         FreeJ2ME-Plus のビルドと文字列置換パッチ
build_ogl.py     openDoJa（3D）のビルドと文字列置換パッチ
vendor/          固定した上流ソース（編集しない。ハッシュは UPSTREAM.json）
tests/           自作データだけで動く検証
```

**上流を変えるときはパッチ、足すときは新しいクラス。** `vendor/` の原本は書き換えず、
既存クラスの変更は `build.py` / `build_ogl.py` の置換として書きます。置換前の文字列はちょうど 1 回現れることを
`assert text.count(old)==1` で確かめ、上流が変わったらビルドが止まるようにします。
まとまった処理は置換文字列に埋め込まず、`src/` か `src-ogl/` に新しいクラスとして置いて、パッチからはそれを呼ぶだけにします。

**Java と JavaScript の境目。** Java からブラウザへの受け渡しは `BrowserRuntime` などの `native` メソッドと、
`app.js` が `cheerpjRunLibrary` で得たクラスの呼び出しだけで行います。受け渡しの形を変えたら両側を同じコミットで直します。

`web/` の中の分担：

| ファイル | 役割 |
| --- | --- |
| `app.js` | 画面の状態、DOM、CheerpJ の起動、各モジュールのつなぎ |
| `loader.mjs` | JAR / JAM / SP の読み込みと判定 |
| `audio.mjs` / `instruments.mjs` | Web Audio の簡易音源と PCM 再生 / 利用者が選んだ音色ファイルの読み込み |
| `haptics.mjs` | 振動（端末とゲームパッド） |
| `gl3d.mjs` | WebGL2 での 3D 描画（試験中） |
| `index.html` / `style.css` / `_headers` | ページ、見た目、配信時のヘッダー |

DOM（`document`、`window`）に触るのは `app.js` だけにし、`*.mjs` は DOM に依存しない形に保ちます（Node のテストで直接読み込めるように）。
DOM にも CheerpJ にも触らない処理が `app.js` に 10 行以上たまったら、`*.mjs` へ移してテストを付けることを考えます。

## ファイルの分け方

- 1 ファイルが **500 行**を超えたら役割で分けることを考え、**800 行**を超える前に分けます。
  行数よりも「役割が 2 つ以上混ざったか」を優先して判断します。
- `web/` のファイル名は役割を表す英小文字の名詞（例：`loader.mjs`）。Java は既存どおり UpperCamelCase のクラス名。
- テストは `tests/` に置きます。Node は `<名前>.test.mjs`、ブラウザと音声は `.cjs`、Java は `*Checks.java`、Python は `test_*.py`。
- ファイルを分けるときは、**移動だけのコミット**と**中身を変えるコミット**を分けます（差分を読みやすくするため）。
- ファイルを足したら、同じコミットで `public_audit.py` の `OWN_FILES` に足します。
- 同じ処理を 2 か所目に書きそうになったら、共通の関数にします。3 か所目まで待ちません。

## 書き方の約束

- **書式**：既存ファイルに合わせた、複数の文を 1 行にまとめる圧縮形式。コメントは「なぜそうしたか」を 1〜2 行だけ。
- **言語**：コード（名前・コメント）と commit message は英語、画面の文言・README・Issue・PR は日本語。
- **Java の版**：`src/p905i/web/` は `--release 8`（CheerpJ 8 互換）。Java 17 の機能は `src-ogl/` だけで使います。
- **JavaScript**：`web/` は ESM。外部ライブラリは追加しません。CommonJS はテストの `.cjs` だけ。
- **ライセンス表示**：新しいソースの先頭には既存ファイルと同じ SPDX 行を書きます。上流を変えたら `THIRD_PARTY.md` に要点を追記し、
  `build_support.py` の `MODIFIED` の日付を更新します。
- **推測で補わない**：仕様や実機で確かめていない入力は無音・ログ出力で扱い、それらしい音や絵を合成しません。
  分かっていない値を仮に置くときは名前付きの定数にし、コメントに `provisional` と根拠（関係する Issue など、例 `#12`）を書きます。
- **私的データ**：実ゲームで確かめた結果を書くときも、ゲーム名・素材・パスは書きません。テストは `tests/build_fixture.py` が作る
  `TestIappli` / `TestOgl` と、数式で合成した波形だけを使います。

## 実装の進め方

1. **Issue を確かめる。** 当てはまる Issue があればそれを使い、なければ作ります。挙動があいまいな点は実装の前に Issue で決めます。
   Issue にゲームの JAR・素材・保存データを添付しません。
2. **ブランチを切る。** 下の命名ルールに従います。1 Issue = 1 ブランチ。
3. **テストを書く。** 不具合の修正では、まず自作データで再現するテストを書きます。
4. **実装する。** リファクタリング（動きを変えない整理）と機能の変更は、コミットを分けます。大きければ PR も分けます。
5. **ビルドして確かめる。** ソースを変えたら `python build.py && python build_ogl.py` で必ずビルドし直し、
   [AGENTS.md](AGENTS.md) の「ビルドと検証」の表にある検証を通します。画面が変わるときはブラウザで操作して確かめ、
   PR にスクリーンショットを付けます（自作データの画面だけ）。
6. **ドキュメントを直す。** 対応範囲が変わったら README の「現在の対応範囲」を、上流への変更は `THIRD_PARTY.md` を、
   ルールが変わったらこのファイルと AGENTS.md を更新します。
7. **PR を出す。** コミット前の全体確認と `python public_audit.py --tracked` を通してから出します。
   1 PR につき Issue 1 つが目安です。本文に `Closes #番号` を書きます。

## ブランチ・コミット・PR

形式は [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に合わせます。

### 種類（type）

| type | 使う場面 |
| --- | --- |
| `feat` | 機能の追加・変更（対応 API の追加、表示や操作の改善など） |
| `fix` | 不具合の修正 |
| `perf` | 動きを変えない高速化 |
| `docs` | ドキュメントだけの変更 |
| `refactor` | 動きを変えないコードの整理 |
| `test` | テストの追加・修正だけ |
| `chore` | ビルド設定、依存関係、CI、公開検査、リポジトリ設定など |

### 範囲（scope、任意）

変更の場所がはっきりしているときだけ付けます。

| scope | 対象 |
| --- | --- |
| `runtime` | FreeJ2ME-Plus 側（`src/`、`build.py` のパッチ） |
| `ogl` | 3D 描画（`src-ogl/`、`build_ogl.py`、`web/gl3d.mjs`） |
| `audio` | 音（`web/audio.mjs`、`web/instruments.mjs`、音声系 Java） |
| `ui` | 画面・入力・保存・振動（`web/app.js`、`web/loader.mjs`、`web/haptics.mjs` など） |
| `server` | ローカルサーバーと起動スクリプト（`serve.py`、`Start-Emulator.*`） |
| `release` | 公開検査・ライセンス表示・配布（`public_audit.py`、`notices.py`、`package.py`、CI の公開） |
| `deps` | 上流ソースや依存パッケージの更新 |

足りなければ増やしてかまいません。増やしたらこの表にも追記します。

### ブランチ名

```
<type>/<issue番号>-<短い英語の kebab-case>
```

- 例：`feat/12-cube-map-reflection`、`fix/30-scratchpad-offset`、`docs/contributing-rules`
- 対応する Issue がなければ番号は省きます。
- 英小文字・数字・ハイフンだけを使い、3〜5 語程度に収めます。
- 並行して作業するときは、ブランチごとに `serve.py --port` を分けます。

### コミットメッセージ（英語）

```
<type>(<scope>): <summary>

<本文（任意）：なぜ変えたか>
```

- 例：`feat(ogl): draw cube map reflections on texture unit 1`、`fix(audio): keep presenter attributes after the sound is disposed`
- summary は英語の命令形、小文字始まり、末尾にピリオドを付けず、72 文字以内。
- 保存データや公開 URL の互換性を壊す変更は type の後ろに `!` を付け、本文に `BREAKING CHANGE:` を書きます。
- 1 コミット 1 目的を目安にします。`git add` は許可リストのファイルを明示して行い、`git add -A` / `git add .` は使いません。

### PR タイトル（日本語）

```
<type>(<scope>): <日本語の要約>
```

- 例：`feat(ogl): 環境マップの反射を WebGL2 で描く`
- type と scope はコミットと同じ英語の語を使い、要約だけ日本語で書きます。

### PR 本文（日本語）

[`.github/pull_request_template.md`](.github/pull_request_template.md) の見出しに沿って書きます。
GitHub で PR を作ると自動で本文に入ります。

| 見出し | 書くこと |
| --- | --- |
| 概要 | 何を変えたかを 1〜2 文で |
| 関連 Issue | `Closes #番号`（なければ「なし」） |
| 変更前 / 変更後 | 使う人から見た違い |
| 変更内容 | 主な変更点の箇条書き |
| 確認方法 | 実行したビルド・検証、画面の変更なら自作データでのスクリーンショット |
| 補足 | 仮の値、未対応のまま残した入力、レビューで見てほしい点（なければ省略） |
