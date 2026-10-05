// decision-sheet の公開前点検と裁定 JSON の書き出しのテスト。
// 守りたいことは2つ。
// 1. 受け取った JSON で「見ていない」「推奨に同意した」「一括で埋めた」が区別でき、別の会話でも案の中身が読める。
// 2. シートは shell.html を写して2つの区画だけを書く。前のシートへの継ぎ足し（doctype の二重、CSS の積層）を公開前に止める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check, loadSheet } from './check.mjs';

const SHELL = readFileSync(new URL('./shell.html', import.meta.url), 'utf8');
const AT = '2026-10-05T03:00:00.000Z';

// 推奨は A・fix・B とばらしてある。推奨を A に決め打ちする実装はここで落ちる。
const SHEET_JS = `
const SHEET = { id: 'test-2026-10-05', title: 'テスト 裁定シート 10/5', source: { repo: 'example/app', sha: 'abc1234' }, lead: '吹き出しを比べます。' };
const TOPICS = [
  {
    id: 'tip', kind: 'detail', issue: null,
    title: '吹き出しの中身', fact: 'いまは名前を「、」でつないだ 1 行。',
    recommended: 'A', reason: 'どこで止まっているかが一目でわかる。',
    variants: [
      { key: 'current', label: '名前を「、」でつなぐ', pro: [], con: [] },
      { key: 'A', label: '一日の流れで並べる', pro: ['止まった所が見える'], con: ['大きい'] },
      { key: 'B', label: 'まだの押印だけ', pro: ['短い'], con: ['済みが見えない'] }
    ],
    sub: { key: 'scope', question: 'どの表に当てるか', recommended: 'daily',
           options: [{ key: 'daily', label: '日報だけ' }, { key: 'all', label: 'すべての表' }] },
    render: (key, ctx) => ctx.chrome(key === 'current' ? '<p>巡視代理人、終業職長</p>' : ctx.chg('<p>案 ' + key + '</p>'))
  },
  {
    id: 'row-open', kind: 'contrast', issue: 330,
    title: '日報の行を押したときの動き', fact: '設計は行全体で開く。実装は日付のリンクだけ。',
    recommended: 'fix', reason: '現場一覧はすでに行全体で開く。',
    design: '行のどこを押しても帳票が開く。', impl: '日付のリンクだけが帳票を開く。'
  },
  {
    id: 'pos', kind: 'shape', issue: null,
    title: '吹き出しを出す場所', fact: 'いまは行の上に出る。',
    recommended: 'B', reason: 'カーソルの動線をふさがない。',
    variants: [
      { key: 'current', label: '行の上', pro: [], con: [] },
      { key: 'A', label: '数のすぐ右', pro: [], con: [] },
      { key: 'B', label: '列の右', pro: [], con: [] }
    ],
    render: (key, ctx) => ctx.chrome(key === 'current' ? '<p>上</p>' : ctx.chg('<p>' + key + '</p>'))
  }
];
`;

function fillRegion(html, begin, end, body) {
  const at = html.indexOf(begin);
  const to = html.indexOf(end);
  assert.ok(at >= 0 && to > at, `shell.html に ${begin} 〜 ${end} の区画がある`);
  return html.slice(0, at + begin.length) + '\n' + body + '\n' + html.slice(to);
}
const fillSheet = (html, js) => fillRegion(html, '/* SHEET:BEGIN */', '/* SHEET:END */', js);
const fillChrome = (html, chrome) => fillRegion(html, '<!-- CHROME:BEGIN -->', '<!-- CHROME:END -->', chrome);

const TITLE = 'テスト 裁定シート 10/5';
const setTitle = (html, title) => html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
const sheet = (js = SHEET_JS) => setTitle(fillSheet(SHELL, js), TITLE);
const plain = (x) => JSON.parse(JSON.stringify(x));
const codes = (errors) => plain(errors).map((e) => (e.topic ? `${e.code}:${e.topic}` : e.code));
const load = () => loadSheet(sheet());
const exported = ({ SHEET, TOPICS, core }, state) => plain(core.buildDecisions(SHEET, TOPICS, state, AT));

// ---- ① 公開前の点検 ----

test('shell.html そのままでも点検に通る（付属の例のシートが正しい）', () => {
  assert.deepEqual(codes(check(SHELL, SHELL)), []);
});

test('2つの区画だけを書いたシートは点検に通る', () => {
  assert.deepEqual(codes(check(sheet(), SHELL)), []);
});

test('shell.html は公開用の断片で、doctype・html・head・body を持たない（公開時に Artifact が包むので、持つと二重になる）', () => {
  assert.doesNotMatch(SHELL, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
});

test('区画の外を書き換えたシートは shell-modified で止まる（前のシートへの継ぎ足しを防ぐ）', () => {
  const html = sheet() + '\n<style>.m-pop{background:#20201e}</style>';
  assert.ok(codes(check(html, SHELL)).includes('shell-modified'));
});

test('外枠の区画に完全な HTML 文書を貼ると doctype で止まる', () => {
  const html = fillChrome(sheet(), '<!doctype html><html><head></head><body><template id="chrome"><!--SLOT--></template></body></html>');
  assert.ok(codes(check(html, SHELL)).includes('doctype'));
});

test('案同士で描画が同じなら same-render で止まる', () => {
  const html = sheet(SHEET_JS.replace(`'<p>案 ' + key + '</p>'`, `'<p>案</p>'`));
  assert.ok(codes(check(html, SHELL)).includes('same-render:tip'));
});

test('<title> は SHEET.title と同じなら書き換えてよく、違えば title-mismatch', () => {
  assert.deepEqual(codes(check(sheet(), SHELL)), []);
  assert.ok(codes(check(setTitle(sheet(), '別の名前'), SHELL)).includes('title-mismatch'));
});

test('SHEET 区画に </script> を含むシートは script-close で止まる（ブラウザではそこでスクリプトが閉じて白紙になる）', () => {
  const html = sheet(SHEET_JS.replace(`fact: 'いまは行の上に出る。'`, `fact: 'いまは行の上に出る。</script>'`));
  assert.ok(codes(check(html, SHELL)).includes('script-close'));
});

// ---- ① の論点ごとの検査（シェル内の validate） ----

test('案の label が空なら missing-field（JSON から案の名前が消える）', () => {
  const s = load();
  s.TOPICS[2].variants[1].label = '';
  assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('missing-field:pos'));
});

test('issue が正の整数でも null でもなければ bad-issue', () => {
  const s = load();
  s.TOPICS[0].issue = '12"><script>';
  s.TOPICS[2].issue = 3.5;
  const found = codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx));
  assert.ok(found.includes('bad-issue:tip'));
  assert.ok(found.includes('bad-issue:pos'));
});

test('外枠に差し込む文字列の $ はそのまま残る', () => {
  const { ctx } = load();
  assert.ok(ctx.chrome('<p>US$$ と $& と $1</p>').includes('<p>US$$ と $& と $1</p>'));
});

test('形・細部の論点に現状がなければ no-current', () => {
  const s = load();
  s.TOPICS[0].variants = s.TOPICS[0].variants.filter((v) => v.key !== 'current');
  assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('no-current:tip'));
});

test('現状のほかに案が1つしかなければ too-few-variants', () => {
  const s = load();
  s.TOPICS[2].variants = s.TOPICS[2].variants.filter((v) => v.key !== 'B');
  s.TOPICS[2].recommended = 'A';
  assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('too-few-variants:pos'));
});

test('推奨が選べる値に含まれなければ bad-recommended（対比の論点は fix・amend・hold だけ）', () => {
  const s = load();
  s.TOPICS[0].recommended = 'Z';
  s.TOPICS[1].recommended = 'A';
  const found = codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx));
  assert.ok(found.includes('bad-recommended:tip'));
  assert.ok(found.includes('bad-recommended:row-open'));
});

test('現状以外の案に「変わる所」の枠がなければ no-chg', () => {
  const s = load();
  s.TOPICS[2].render = (key, ctx) => ctx.chrome('<p>' + key + '</p>');
  assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('no-chg:pos'));
});

test('render が例外を投げる案があれば、現状の案でも render-error で止まる（公開すると、その論点から後ろの画面が止まる）', () => {
  for (const throwingKey of ['current', 'B']) {
    const s = load();
    const original = s.TOPICS[2].render;
    s.TOPICS[2].render = (key, ctx) => {
      if (key === throwingKey) throw new Error('boom');
      return original(key, ctx);
    };
    assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('render-error:pos'), throwingKey);
  }
});

test('論点が8つ以上なら too-many-topics', () => {
  const s = load();
  for (let i = 0; i < 5; i++) s.TOPICS.push({ ...s.TOPICS[2], id: `pos${i}` });
  assert.ok(codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx)).includes('too-many-topics'));
});

test('推奨の理由や照合用の sha が空なら missing-field', () => {
  const s = load();
  s.TOPICS[0].reason = '';
  s.SHEET.source.sha = '';
  const found = codes(s.core.validate(s.SHEET, s.TOPICS, s.ctx));
  assert.ok(found.includes('missing-field:tip'));
  assert.ok(found.includes('missing-field'));
});

// ---- ② 裁定 JSON の書き出し ----

test('開いたばかりのシートは、すべての論点が undecided で書き出される（触らずにコピーしても承認に見えない）', () => {
  const s = load();
  assert.deepEqual(exported(s, s.core.initialState(s.TOPICS)), {
    schema: 'decision-sheet/1',
    sheet: 'test-2026-10-05',
    title: 'テスト 裁定シート 10/5',
    source: { repo: 'example/app', sha: 'abc1234' },
    exportedAt: AT,
    decisions: [
      { topic: 'tip', kind: 'detail', issue: null, decision: 'undecided', label: null, recommended: 'A', via: null, sub: { scope: 'undecided' }, memo: '' },
      { topic: 'row-open', kind: 'contrast', issue: 330, decision: 'undecided', label: null, recommended: 'fix', via: null, memo: '' },
      { topic: 'pos', kind: 'shape', issue: null, decision: 'undecided', label: null, recommended: 'B', via: null, memo: '' }
    ],
    note: ''
  });
});

test('1つずつ選ぶと via は pick になり、label に案の名前が入る（別の会話でも中身が読める）', () => {
  const s = load();
  let st = s.core.initialState(s.TOPICS);
  st = s.core.decide(st, 'tip', 'B');
  st = s.core.decide(st, 'row-open', 'amend');
  st = s.core.decide(st, 'pos', 'current');
  assert.deepEqual(exported(s, st).decisions.map((d) => [d.topic, d.decision, d.label, d.via]), [
    ['tip', 'B', 'まだの押印だけ', 'pick'],
    ['row-open', 'amend', '設計を変える', 'pick'],
    ['pos', 'current', '行の上', 'pick']
  ]);

  st = s.core.decide(st, 'tip', 'none');
  st = s.core.decide(st, 'row-open', 'hold');
  st = s.core.decide(st, 'pos', 'hold');
  assert.deepEqual(exported(s, st).decisions.map((d) => [d.topic, d.decision, d.label]), [
    ['tip', 'none', 'どの案も採らない'],
    ['row-open', 'hold', '保留'],
    ['pos', 'hold', '保留']
  ]);
});

test('「残りを推奨で埋める」は未裁定の論点と小問だけを推奨で埋め、via は bulk（選び済みは上書きしない）', () => {
  const s = load();
  let st = s.core.decide(s.core.initialState(s.TOPICS), 'pos', 'A');
  st = s.core.fillRest(st, s.TOPICS);
  assert.deepEqual(exported(s, st).decisions.map((d) => [d.topic, d.decision, d.label, d.via, d.sub ?? null]), [
    ['tip', 'A', '一日の流れで並べる', 'bulk', { scope: 'daily' }],
    ['row-open', 'fix', '実装を設計に合わせる', 'bulk', null],
    ['pos', 'A', '数のすぐ右', 'pick', null]
  ]);
});

test('案のタブを切り替えて見るだけでは、裁定は変わらない', () => {
  const s = load();
  let st = s.core.view(s.core.initialState(s.TOPICS), 'tip', 'B');
  st = s.core.view(st, 'pos', 'A');
  st = s.core.decide(st, 'row-open', 'fix');
  st = s.core.view(st, 'tip', 'A');
  assert.deepEqual(exported(s, st).decisions.map((d) => [d.topic, d.decision, d.via]), [
    ['tip', 'undecided', null],
    ['row-open', 'fix', 'pick'],
    ['pos', 'undecided', null]
  ]);
});

test('小問の答えは sub に入り、論点の裁定は変えない', () => {
  const s = load();
  const st = s.core.decideSub(s.core.initialState(s.TOPICS), 'tip', 'all');
  const tip = exported(s, st).decisions[0];
  assert.deepEqual([tip.decision, tip.sub], ['undecided', { scope: 'all' }]);
});

test('一括で埋めるのは未裁定の論点の小問だけ（裁定済みの論点の小問は人が選ぶまで undecided）', () => {
  const s = load();
  let st = s.core.decide(s.core.initialState(s.TOPICS), 'tip', 'B');
  st = s.core.fillRest(st, s.TOPICS);
  const tip = exported(s, st).decisions[0];
  assert.deepEqual([tip.decision, tip.via, tip.sub], ['B', 'pick', { scope: 'undecided' }]);
});

test('メモと全体メモは書き出しに入る', () => {
  const s = load();
  let st = s.core.setMemo(s.core.initialState(s.TOPICS), 'pos', '列の幅が狭いときは下に出す');
  st = s.core.setNote(st, '来週の朝礼で確認');
  const out = exported(s, st);
  assert.deepEqual([out.decisions[2].memo, out.note], ['列の幅が狭いときは下に出す', '来週の朝礼で確認']);
});

test('裁定のリセットは全論点の裁定と小問を未裁定に戻し、メモ・全体メモ・見ている案は残す（一括で埋めたのを取り消せる）', () => {
  const s = load();
  let st = s.core.decide(s.core.initialState(s.TOPICS), 'pos', 'A');
  st = s.core.view(st, 'pos', 'B');
  st = s.core.setMemo(st, 'pos', '列の幅が狭いときは下に出す');
  st = s.core.setNote(st, '来週の朝礼で確認');
  st = s.core.fillRest(st, s.TOPICS);
  st = s.core.clearDecisions(st, s.TOPICS);
  const out = exported(s, st);
  assert.deepEqual(
    out.decisions.map((d) => [d.decision, d.via, d.label]),
    [['undecided', null, null], ['undecided', null, null], ['undecided', null, null]],
  );
  assert.deepEqual(out.decisions[0].sub, { scope: 'undecided' });
  assert.deepEqual([out.decisions[2].memo, out.note], ['列の幅が狭いときは下に出す', '来週の朝礼で確認']);
  assert.equal(st.topics.pos.view, 'B');
});

test('保存した下書きは今の TOPICS に合わせて読み戻す（案・推奨・小問が変わった論点は未裁定に戻す）', () => {
  const s = load();
  let st = s.core.initialState(s.TOPICS);
  st = s.core.view(s.core.decide(st, 'tip', 'B'), 'tip', 'B');
  st = s.core.decideSub(st, 'tip', 'all');
  st = s.core.setMemo(st, 'tip', '済みは灰色で');
  st = s.core.decide(st, 'pos', 'A');
  st = s.core.decide(st, 'row-open', 'fix');
  const saved = plain(st);
  delete saved.topics['row-open'];
  saved.topics.gone = plain(saved.topics.pos);

  // 次の公開では pos の推奨を A に変えた。tip はそのまま。row-open は下書きに無い
  const s2 = load();
  s2.TOPICS[2].recommended = 'A';
  const restored = s2.core.restoreState(saved, s2.TOPICS);
  assert.deepEqual(exported(s2, restored).decisions.map((d) => [d.topic, d.decision, d.via, d.sub ?? null, d.memo]), [
    ['tip', 'B', 'pick', { scope: 'all' }, '済みは灰色で'],
    ['row-open', 'undecided', null, null, ''],
    ['pos', 'undecided', null, null, '']
  ]);
  assert.deepEqual(Object.keys(plain(restored).topics).sort(), ['pos', 'row-open', 'tip']);
});

test('案を消した・小問の key を変えた論点も、未裁定と現状の表示に戻す（壊れた下書きで画面を止めない）', () => {
  const s = load();
  let st = s.core.view(s.core.decide(s.core.initialState(s.TOPICS), 'tip', 'B'), 'tip', 'B');
  st = s.core.decideSub(st, 'tip', 'all');
  const saved = plain(st);

  const s2 = load();
  s2.TOPICS[0].variants = s2.TOPICS[0].variants.filter((v) => v.key !== 'B');
  s2.TOPICS[0].variants.push({ key: 'C', label: '次に押す人', pro: [], con: [] });
  s2.TOPICS[0].sub.key = 'range';
  let restored = s2.core.restoreState(saved, s2.TOPICS);
  assert.equal(plain(restored).topics.tip.view, 'current');
  restored = s2.core.decideSub(restored, 'tip', 'all');
  const tip = exported(s2, restored).decisions[0];
  assert.deepEqual([tip.decision, tip.label, tip.via, tip.sub], ['undecided', null, null, { range: 'all' }]);
});

test('壊れた下書き（null や形の違う値）からでも初期状態で読み戻す', () => {
  const s = load();
  for (const saved of [null, 'x', { topics: null }, { topics: { tip: 'B' } }]) {
    const out = exported(s, s.core.restoreState(saved, s.TOPICS));
    assert.deepEqual(out.decisions.map((d) => d.decision), ['undecided', 'undecided', 'undecided']);
  }
});
