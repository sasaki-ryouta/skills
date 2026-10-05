import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function region(html, begin, end) {
  const start = html.indexOf(begin);
  const finish = html.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) {
    throw new Error(`区画 ${begin} が見つかりません。`);
  }
  return {
    start,
    end: finish + end.length,
    body: html.slice(start + begin.length, finish),
  };
}

function chromeTemplate(html) {
  const chrome = region(html, "<!-- CHROME:BEGIN -->", "<!-- CHROME:END -->");
  const body = html.slice(chrome.start, chrome.end);
  const match = body.match(
    /<template\s+id=["']chrome["'][^>]*>([\s\S]*?)<\/template>/i,
  );
  if (!match) {
    throw new Error("chrome template がありません。");
  }
  return match[1];
}

export function loadSheet(html) {
  const sheet = region(html, "/* SHEET:BEGIN */", "/* SHEET:END */");
  const coreRegion = region(html, "/* CORE:BEGIN */", "/* CORE:END */");
  const context = vm.createContext({});
  // SHEET and core are evaluated together, then exposed through this context.
  const source = `${sheet.body}\nglobalThis.__sheet = { SHEET, TOPICS };\n` +
    `${coreRegion.body}\n` +
    "globalThis.__core = core;";
  vm.runInContext(source, context, { timeout: 1000 });
  const { SHEET, TOPICS } = context.__sheet;
  const core = context.__core;
  const ctx = core.makeCtx(chromeTemplate(html));
  return { SHEET, TOPICS, core, ctx };
}

function stripped(html) {
  let output = html;
  const regions = [
    ["<!-- CHROME:BEGIN -->", "<!-- CHROME:END -->"],
    ["/* SHEET:BEGIN */", "/* SHEET:END */"],
  ];
  for (const [begin, end] of regions) {
    const found = region(output, begin, end);
    output = output.slice(0, found.start) + begin + end +
      output.slice(found.end);
  }
  return output.replace(/(<title\b[^>]*>)[\s\S]*?(<\/title\s*>)/i, "$1$2");
}

export function check(html, shellHtml) {
  const errors = [];
  const documentTags = /<!doctype\b|<(?:html|head|body)\b[^>]*>/i;
  if (documentTags.test(html)) {
    errors.push({
      code: "doctype",
      message: "文書の開始タグは含められません。",
    });
  }
  try {
    if (stripped(html) !== stripped(shellHtml)) {
      errors.push({
        code: "shell-modified",
        message: "shell.html の区画外が変更されています。",
      });
    }
  } catch {
    errors.push({
      code: "shell-modified",
      message: "CHROME または SHEET 区画がありません。",
    });
  }
  try {
    const sheetRegion = region(html, "/* SHEET:BEGIN */", "/* SHEET:END */");
    if (/<\/script\b/i.test(sheetRegion.body)) {
      errors.push({
        code: "script-close",
        message: "SHEET 区画に script を閉じる文字列は含められません。",
      });
    }
    const loaded = loadSheet(html);
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    if (!title || title[1] !== loaded.SHEET.title) {
      errors.push({
        code: "title-mismatch",
        message: "title は SHEET.title と同じにしてください。",
      });
    }
    errors.push(
      ...loaded.core.validate(loaded.SHEET, loaded.TOPICS, loaded.ctx),
    );
  } catch (error) {
    errors.push({
      code: "load-error",
      message: `シートを読み込めません: ${error.message}`,
    });
  }
  return errors;
}

const self = fileURLToPath(import.meta.url);
// シンボリックリンク経由で呼ばれても自分と判定できるよう、実体のパスで比べる
const invoked = process.argv[1] && realpathSync(process.argv[1]) === self;
if (invoked) {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node check.mjs <sheet.html>");
    process.exit(2);
  }
  try {
    const html = readFileSync(input, "utf8");
    const shell = readFileSync(
      new URL("./shell.html", import.meta.url),
      "utf8",
    );
    const errors = check(html, shell);
    if (errors.length) {
      for (const error of errors) {
        console.log(
          `${error.code} ${error.topic || ""} ${error.message}`.trim(),
        );
      }
      process.exitCode = 1;
    } else {
      console.log(`ok: ${loadSheet(html).TOPICS.length} topics`);
    }
  } catch (error) {
    console.log(`load-error  ${error.message}`);
    process.exitCode = 1;
  }
}
