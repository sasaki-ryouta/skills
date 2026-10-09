# skills

自作の Claude Code スキル。

使うときは `~/.claude/skills/<name>` から `skills/<name>` へシンボリックリンクを張る。

```bash
ln -s ~/Documents/workspace/skills/skills/<name> ~/.claude/skills/<name>
```

- **[decision-sheet](./skills/decision-sheet/SKILL.md)** — 人の裁定が要る論点を HTML アーティファクトの裁定シートに並べ、裁定 JSON（`decision-sheet/1`）で受け取る。
- **[process-pre-eval](./skills/process-pre-eval/SKILL.md)** — 月次プロセス評価（5 項目・0〜5 点）のプレ評価を、GitHub と Google Workspace のアクティビティから毎月同じ形で作る。
