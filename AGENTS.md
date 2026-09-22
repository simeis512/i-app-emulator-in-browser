# AGENTS.md

ブラウザで DoJa iアプリを動かす実験的エミュレーター。FreeJ2ME-Plus と openDoJa を
CheerpJ 上で実行する。**ゲーム本体・端末ダンプ・保存データ・第三者の音色バンクは
一切含めない。** 利用者が手元の JAR / JAM / SP を選んで読み込む方式を維持する。

利用者向けの説明は [README.md](README.md)、依存の権利関係は [THIRD_PARTY.md](THIRD_PARTY.md)。

## 守ること

1. **公開は許可リスト方式。** 公開するファイルは `public_audit.py` の `OWN_FILES` に明示する。
   ファイルを足したら同じコミットで `OWN_FILES` にも足す。`git add -A` / `git add .` は使わない。
2. **私的データを持ち込まない。** ゲームの JAR/JAM/SP、端末ダンプ、逆コンパイル結果、抽出素材、
   個人の保存データ、音色バンク（FTRM / SF2 / MA-3 / ROM / DLL）を、リポジトリ・Issue・CI・
   配布物のいずれにも入れない。親ディレクトリのファイルを参照・コピーしない。
   ソースに絶対パスを書くと `public_audit.py` が拒否する。
3. **`vendor/` の原本を編集しない。** 上流への変更は `build.py` / `build_ogl.py` 内の文字列置換
   パッチとして書く。`UPSTREAM.json` のハッシュ照合を壊さないこと。変更の要点は
   `THIRD_PARTY.md` にも追記する。
4. **ソースを変えたら必ず再ビルドする。** `git pull` も `serve.py` も Java をビルドしない。
   古い JAR のまま検証して原因を誤認した事例がある。`serve.py` は起動時にビルドの新旧を表示する。
5. **未対応の入力は無音・ログで扱う。** 推測でそれらしい音や絵を合成しない。
   対応範囲を広げたら README の「現在の対応範囲」も更新する。

## ビルドと検証

必要環境は JDK 17 以上（`JAVA_HOME` か PATH）、Python 3.10 以上、Node.js 20 以上。

```sh
python build.py && python build_ogl.py
```

変更箇所ごとの最小検証:

| 変更した場所 | 実行するもの |
| --- | --- |
| `src/`、`build.py` の Java パッチ | `python check.py` |
| `web/*.mjs`、`web/app.js` | `npm test` |
| `serve.py`、`build_state.py`、`build_support.py` | `python -m unittest discover -s tests -p "test_*.py"` |
| 音声（`web/audio.mjs`、`web/instruments.mjs`、音声系 Java） | `npm run test:audio` |
| UI・入力・保存 | `npm run test:browser` |
| 公開ファイルの増減 | `python public_audit.py` |

`test:audio` と `test:browser` は `python serve.py` と `python tests/build_fixture.py` が前提。
複数の作業を並行させるときは `serve.py --port` を分ける（ポートが変わるとブラウザの保存領域も
分かれるため、互いの保存を壊さない）。

コミット前の全体確認:

```sh
python dependencies.py && python notices.py --check && python check.py && python -m unittest discover -s tests -p "test_*.py" && npm test && python public_audit.py
```

配布 ZIP を作り直す場合は `python package.py`。

## 書き方

既存ファイルの書式に合わせる。このリポジトリは**複数の文を 1 行にまとめた圧縮形式**で、
コメントは「なぜそうしたか」を 1〜2 行だけ書く。説明的なコメントや冗長な命名を新たに持ち込まない。

- `src/p905i/web/` は CheerpJ の Java 8 互換（`--release 8`）。Java 17 は `src-ogl/` のみ。
- `web/` は ESM。外部ライブラリを追加しない。CommonJS はテストの `.cjs` だけ。
- UI 文言・README・Issue は日本語。コード内コメントと commit message は英語。
- 公開テストは自作データのみ。`tests/build_fixture.py` が生成する `TestIappli` の JAR / JAM / SP と、
  数式で合成した波形を使う。実ゲームでの確認結果を書くときも、ゲーム名・素材・パスは公開しない。

## コミット

`git add` は許可リストのファイルを明示して行う。コミット前に `python public_audit.py`、
作業ツリーが整っていれば `python public_audit.py --tracked` も通す（Git の登録内容と
許可リストの完全一致を検査する）。複数の作業を並行させるときは 1 Issue = 1 ブランチにする。
