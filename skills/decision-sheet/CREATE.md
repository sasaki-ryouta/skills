# 裁定シートを作る

用語と論点の種類は [SKILL.md](SKILL.md) にある。

1. **問いを立てる。** 論点ごとに、問いを1行、現状の事実を1〜2文で書き、種類（形・細部・対比）を決める。ラウンドなら、前回の裁定とそのメモを事実に書く。
   完了：すべての論点に問い・事実・種類があり、論点は7つ以内。
2. **案を作る。**
   - 形の論点は、prototype スキルの UI.md（`~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/engineering/prototype/UI.md`）の手順 1「State the question and pick N」と手順 2「Generate radically different variants」に従う。
   - 細部の論点は対照で作る。
   - 対比の論点は、設計の記述と今の実装の振る舞いを1〜2文ずつ書く。
   - モックのデータには、極端な値（いちばん長い名前、いちばん多い件数、空）を入れる。
   - 論点ごとに推奨を1つ選び、理由を1文書く。
   完了：形と細部の論点には現状と2つ以上の案があり、すべての論点に推奨とその理由がある。
3. **外枠を用意する。** リポジトリの `docs/decision/chrome.html` を読む。なければ、アプリの CSS の色の変数とヘッダーの見た目から作り、リポジトリへのコミットを提案する。書式は、`.frame` 自身とその内側だけに効く `<style>` と、`<template id="chrome">…<!--SLOT-->…</template>` の2つ。
   完了：シートに貼る chrome.html がある。
4. **シートを組む。** `~/.claude/skills/decision-sheet/shell.html` を作業場所に写す。CHROME 区画に chrome.html を、SHEET 区画に `SHEET` と `TOPICS` を書き、`<title>` の中身を `SHEET.title` と同じにする。書式は、shell.html の SHEET 区画に付いている例（3種類の論点と小問を1つずつ含む）に従う。`render` は静的な HTML 文字列を返すので、カーソルに応じて動く物は、開いた状態の静止画で描く。ラウンドでも、前のシートではなく shell.html から組む。
   完了：`node ~/.claude/skills/decision-sheet/check.mjs <シート>` が `ok` を出す。
5. **公開する。** Artifact で公開する。タイトルは「<プロジェクト> 裁定シート <月/日>」にする。チャットには URL、論点の数、照合に使う sha を1行で伝える。
   完了：URL を伝えた。
