# decision-sheet: shell.html と check.mjs の実装仕様

裁定シートは、人が案を見比べて論点ごとに裁定し、裁定 JSON をコピーしてエージェントに返すための 1 枚の HTML である。エージェントは shell.html を写して 2 つの区画（CHROME・SHEET）だけを書き、`node check.mjs <シート>` が通ってから公開する。このファイルは shell.html と check.mjs の契約で、テストは `check.test.mjs`。

## ファイル

### shell.html

Artifact で公開する断片。`<!doctype>`・`<html>`・`<head>`・`<body>` を持たない（公開時に Artifact がこれらで包むので、持つと二重になる）。先頭は `<title>`、続いて `<link>`・`<style>`・本文・`<script>`。エージェントが書くのは 3 つの区画と `<title>` の中身（SHEET.title と同じ文字列）だけ。区画は次の 3 つ。

- `<!-- CHROME:BEGIN -->` 〜 `<!-- CHROME:END -->`：外枠（プロジェクトのアプリの見た目）。中身は `<style>`（モック用の CSS。`.frame` 自身とその内側だけに効かせる）と `<template id="chrome">…<!--SLOT-->…</template>`。shell 付属の既定は、汎用のアプリのヘッダー 1 本と最小の CSS。
- `/* SHEET:BEGIN */` 〜 `/* SHEET:END */`：`const SHEET = {...}; const TOPICS = [...];` だけ。shell 付属の既定は、shape・detail・contrast を 1 つずつ含み、sub を 1 つ持つ例のシート。点検に通ること。
- `/* CORE:BEGIN */` 〜 `/* CORE:END */`：DOM に触らない純関数（下記「core」）。ブラウザでも check.mjs でも同じコードを評価する。

SHEET 区画と CORE 区画は同じ `<script>` の中でも別の `<script>` でもよいが、CORE は SHEET の変数に依存せず、引数で受け取る。

### check.mjs

ESM、依存なし（Node 22 の標準モジュールだけ）。

- `export function loadSheet(html)` → `{ SHEET, TOPICS, core, ctx }`。html から SHEET 区画と CORE 区画を取り出し、`node:vm` の 1 つのコンテキストで評価する。CHROME 区画の中にある `<template id="chrome">` の中身を文字列で取り出し、`core.makeCtx(chromeHtml)` で ctx を作る。
- `export function check(html, shellHtml)` → `[{ code, topic?, message }]`。空なら合格。次をすべて合わせて返す。
  - `doctype`：html の中に `<!doctype`・`<html`・`<head`・`<body` の開始タグが 1 つでもある（大文字小文字を問わない）
  - `shell-modified`：html と shellHtml から CHROME 区画と SHEET 区画の中身、`<title>` の中身を除いた残りが一致しない（区画マーカーと `<title>` タグ自体は残りに含める）。区画が見つからない場合も同じ
  - `title-mismatch`：`<title>` の中身が SHEET.title と違う
  - `script-close`：SHEET 区画に `</script`（大文字小文字を問わない）がある。ブラウザはそこでスクリプトを閉じるので、vm では通ってもブラウザでは白紙になる
  - `load-error`：loadSheet が例外を投げた
  - `core.validate(SHEET, TOPICS, ctx)` の結果
- CLI：`node check.mjs <sheet.html>`。shellHtml は check.mjs と同じディレクトリの shell.html。違反があれば 1 行に 1 件ずつ `<code> <topic> <message>` を出して exit 1、なければ `ok: <論点の数> topics` を出して exit 0。

## core（CORE 区画）

- `makeCtx(chromeHtml)` → `{ chg(html), chrome(inner) }`。`chg` は「現状から変わる所」の印（点線の枠）を付けたラッパー（例：`<span class="chg">…</span>`）を返す。`chrome` は chromeHtml の `<!--SLOT-->` を inner で置き換えた文字列を返す。置き換えは文字どおりに行い、inner の `$` を特別扱いしない。
- `validate(SHEET, TOPICS, ctx)` → `[{ code, topic?, message }]`。message は何がだめかを日本語で 1 文。
  - `missing-field`：SHEET の id・title・source.repo・source.sha のどれかが空（topic なし）。論点の id・title・fact・reason のどれかが空、案の key・label のどれかが空、または contrast の design・impl が空（topic あり）
  - `bad-issue`：issue が正の整数でも null でもない
  - `too-many-topics`：論点が 8 つ以上、または 0（topic なし）
  - `bad-kind`：kind が shape・detail・contrast 以外
  - `duplicate-id`：論点の id が重複
  - shape・detail の論点
    - `no-current`：variants に key `current` がない
    - `too-few-variants`：current 以外の案が 2 つ未満
    - `bad-recommended`：recommended が variants の key に含まれない（`current` は可）
    - `same-render`：`render(key, ctx)` の結果が案同士で同じ（同じ組が 1 つでもあれば 1 件）
    - `no-chg`：current 以外の案の render 結果に chg の印がない
    - `render-error`：`render(key, ctx)` が例外を投げた（current を含む。案ごとに 1 件）。公開すると、その論点から後ろの画面が初期化されずに止まる
    - `bad-sub`：sub があり、options が 2 つ未満、option の key が重複、または sub.recommended が options の key にない
  - contrast の論点
    - `bad-recommended`：recommended が `fix`・`amend`・`hold` 以外
- `initialState(TOPICS)` → `{ topics: { [id]: { sig, decision: 'undecided', via: null, view, memo: '', sub? } }, note: '' }`。sig は論点の中身の照合用の文字列で、kind・recommended・案の key と label・sub の key と options の key と sub.recommended から作る（fact・pro・con・render は含めない）。view は shape・detail なら `'current'`、contrast なら `null`。sub は論点に sub があるときだけ `{ [sub.key]: 'undecided' }`。
- `view(state, id, key)`：見ている案だけを変える。decision と via は変えない。
- `decide(state, id, value)`：decision を value にし、via を `'pick'` にする。
- `decideSub(state, id, value)`：sub の答えだけを変える。decision と via は変えない。
- `fillRest(state, TOPICS)`：decision が `'undecided'` の論点だけ、decision を recommended、via を `'bulk'` にする。そのとき埋めた論点に限り、sub の答えが `'undecided'` で sub.recommended があれば、それで埋める。すでに裁定済みの論点の sub は埋めない（一括で入ったことが JSON から見分けられなくなるため）。
- `clearDecisions(state, TOPICS)`：すべての論点の decision を `'undecided'`、via を null、sub の答えを `'undecided'` に戻す。view・memo・note は変えない（一括で埋めたのを取り消すため。書いたメモは消さない）。
- `setMemo(state, id, text)`、`setNote(state, text)`：論点のメモ、全体メモを変える。
- `restoreState(saved, TOPICS)`：localStorage から読んだ値を今の TOPICS に合わせて state にする。saved が object でない、または saved.topics が object でなければ initialState を返す。今の TOPICS の各論点について、saved.topics[id] が object で sig が今の sig と同じなら、その論点の状態（decision・via・view・memo・sub）を引き継ぐ。ただし decision は、via が `'pick'` か `'bulk'` のときだけ via と一緒に引き継ぐ（via のない裁定は、人が選んだのか分からないため）。それ以外は initialState の論点にする（案や推奨が変わった論点の古い裁定を、人が新しい案を見ないまま書き出さないため）。今の TOPICS にない論点は捨てる。saved.note が文字列なら引き継ぐ。
- 状態の関数はすべて新しい state を返す。呼び出し側は戻り値を使う。
- `choiceLabel(topic, value)` → 画面に出す選択肢の表記。案は `A. <label>`、current は `現状（<label>）`、`fix` は「実装を設計に合わせる」、`amend` は「設計を変える」、`hold` は「保留する」、`none` は「どれも採らない（メモに方針を）」。fact や推奨の行の「A」とタブ・ラジオを突き合わせられるよう、案は key を前に出す。裁定 JSON の label には使わない。
- `buildDecisions(SHEET, TOPICS, state, exportedAt)` → 下の「裁定 JSON」のオブジェクト。

## 裁定 JSON（decision-sheet/1）

```json
{
  "schema": "decision-sheet/1",
  "sheet": "<SHEET.id>",
  "title": "<SHEET.title>",
  "source": { "repo": "<SHEET.source.repo>", "sha": "<SHEET.source.sha>" },
  "exportedAt": "<exportedAt>",
  "decisions": [
    { "topic": "<id>", "kind": "detail", "issue": null, "decision": "A", "label": "一日の流れで並べる",
      "recommended": "A", "via": "pick", "sub": { "scope": "daily" }, "memo": "" }
  ],
  "note": "<state.note>"
}
```

- decisions は TOPICS の順。各要素のキーもこの順。`sub` は論点に sub があるときだけ置く。
- decision の値：案の key（`current` を含む）、`fix`、`amend`、`hold`、`none`、`undecided`。
- label：案の key ならその variant.label。`fix` は「実装を設計に合わせる」、`amend` は「設計を変える」、`hold` は「保留」、`none` は「どの案も採らない」、`undecided` は null。
- via：`'pick'`、`'bulk'`、または null（undecided のとき）。
- issue：数値か null。

## 画面（shell の DOM 部分）

土台は 2026-09-30 に実際に使った裁定シート（非公開）。見た目と構成はこれを引き継ぎ、次のとおりに変える・足す。

- `<title>` と h1 は SHEET.title。ヘッダーのメタ行に repo と sha、SHEET.lead を本文の先頭に置く。
- テーマ：色は `:root` のトークンで持つ。状態は意味トークン（`--success-*`・`--warning-*`・`--danger-*`。それぞれ `-fg`・`-bg`・`-line` の 3 点で 1 組）で描く：1 つずつ選んだ論点は success、一括で推奨は warning（人が 1 つずつは見ていない）、未裁定は `--soft` と点線の `--line`、リセットの構えと内部エラーは danger。色の切り替えには 0.15 秒の遷移を付ける。ダークは `@media (prefers-color-scheme: dark)` の `:root:not([data-theme="light"])` と、`:root[data-theme="dark"]` の両方に同じ値で定義する。body に背景色を置く。`.frame` の中（モック）は外枠の CSS の色で描く。
- 論点ごとの帯：見出し（issue があれば `#番号` と `https://github.com/<repo>/issues/<番号>` へのリンク）、fact、推奨とその理由。案のタブ・表示中の案の名前・ラジオ・推奨の行・状態の札の表記はすべて core.choiceLabel を通す。
  - shape・detail：案のタブ（見る。`aria-pressed`。推奨の案に「推奨」の札、裁定中の案に「✓裁定」の札を付ける。一括で推奨の裁定は「✓一括」と warning の色にする）、スマホ／PC の幅の切替（`.frame` を max-width 390px と 100% で切り替え、`.frame` は `container-type: inline-size`。この `.frame` の土台の CSS と、chg の印（点線の枠。モックは外枠の明るい色で描くので、ページのテーマに合わせず固定色）の CSS は CHROME 区画ではなく shell 自身の CSS に置く。CHROME 区画は差し替えられるため。土台は詳細度 0 にして外枠の `.frame` の指定を優先し、`isolation: isolate` でモックの z-index をフレームの中に閉じ込める）、モック（render が自分で `ctx.chrome` を呼ぶので、shell は render の戻り値を包まずにそのまま入れる）、表示中の案の pro（＋）と con（－）、凡例「点線の枠 = 現状から変わる所」。
  - contrast：設計と実装の文を 2 列で並べる（モックなし）。
  - 右の欄が裁定（決める）。ラジオで選ぶ。shape・detail は各案、「保留する」、「どれも採らない（メモに方針を）」。contrast は「実装を設計に合わせる」「設計を変える」「保留する」。推奨の選択肢に「推奨」の札を、タブで表示中の案に「表示中」の札を付ける（見ている案と裁定がずれていても気づけるように。タブの「✓裁定」と対になる）。sub があれば小問のラジオ、メモ欄、状態の札（未裁定／裁定: <choiceLabel>／一括で推奨: <choiceLabel>）。札は `data-state`（`undecided`・`picked`・`bulk`）で色を変える。
- 全体メモの欄（state.note）。メモと全体メモの変更は core.setMemo・setNote を通す。
- 画面下に固定のドック。ドックが最後の内容を隠さないよう、本文の下に余白を取る。文言や件数が変わっても、ボタンの幅・位置とドックの高さを変えない（並びが組み直されてちらつかないように）。
  - 「裁定済み n / N」：数字は等幅フォントで描く（本文の書体は数字の幅がそろわず、tabular-nums も効かない）。
  - 「残りを推奨で埋める」：ページを再読み込みせず、state を更新して描き直す（保存できない環境でも裁定が消えないように）。
  - 「裁定をリセット」：core.clearDecisions を呼ぶ。Artifact では confirm() が出ないので、2 度押しで確定する。1 度押すと「もう一度押すとリセット」に変わり、4 秒以内にもう一度押すと実行して「リセットしました。メモは残っています。」と出す。ダブルクリックで実行しないよう、構えてから 0.5 秒は 2 度目を受け付けない。2 つの文言を同じマスに重ね、長いほうの幅を常に取る。
  - 「JSON をコピー」。
  - 状態のメッセージ（`role="status"`）：状態が変わったら消す。空のときも 1 行分の高さを取り、1 行に収まらない分は省略記号で切る。
  - 下端の余白に `env(safe-area-inset-bottom)` を足す（Artifact の包みは `viewport-fit=cover` を持つ）。
- JSON の欄（readonly の textarea）。状態が変わるたびに buildDecisions で作り直す。コピーに失敗したら欄を選択状態にして、⌘C / Ctrl+C を促す。
- 下書き：state を localStorage に保存する。キーは `'decision-sheet:' + SHEET.id`。読み書きはすべて try/catch で包み、読めなくても動く。読み戻しは core.restoreState を通す。
- 自己検査：読み込み時に `core.validate` を走らせ、エラーがあれば先頭に「内部エラー」として一覧を出す。
- shell 付属の既定の外枠は、`.frame` の内側に描くアプリのヘッダー 1 本（アプリ名など）と、それを描く最小の CSS。CHROME 区画の CSS のセレクタはすべて `.frame` 自身かその子孫にする。
- 外部の読み込みは Google Fonts のスタイルシートだけ。外部のスクリプトは読まない。
- 幅 375px でページ全体に横スクロールが出ない（モックの中の表は `.frame` の中で横スクロールしてよい）。
- `prefers-reduced-motion` を尊重する。フォーカスリングを消さない。

## コードの書き方

shell.html はシートを作るたびにエージェントが読み、写す。1 行に 1 文、関数ごとに改行し、意図が読みにくい所にだけ短いコメントを付ける。圧縮した書き方（1 行に複数の文、300 字を超える行）にしない。check.mjs も同じ。使わない関数・クラスは残さない。`i` のような慣用を除き、1〜2 文字の変数名を使わない。状態が変わったときの書き出し（buildDecisions）は 1 回だけ呼ぶ。
