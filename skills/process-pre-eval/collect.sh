#!/bin/zsh
# 対象月のアクティビティを GitHub と Google Workspace から集める。
# 使い方: collect.sh YYYY-MM OUTDIR
# 出力: OUTDIR/summary.md（件数）と、判断の材料になる抽出ファイル群。
set -u
MONTH="$1"; OUT="$2"
GH_USER=sasaki-ryouta
ORG=O2-CONNECTIVE
ME=users/105410155704963450902   # Chat 上の本人
MY_NAME=佐々木亮太

Y=${MONTH%-*}; M=${MONTH#*-}
FIRST="$MONTH-01"
LAST=$(date -j -v+1m -v-1d -f %Y-%m-%d "$FIRST" +%Y-%m-%d)
NEXT=$(date -j -v+1m -f %Y-%m-%d "$FIRST" +%Y-%m-%d)
# JST の月初・翌月初を UTC で表す
START_UTC=$(date -j -v-1d -f %Y-%m-%d "$FIRST" +%Y-%m-%dT15:00:00Z)
END_UTC=$(date -j -v-1d -f %Y-%m-%d "$NEXT" +%Y-%m-%dT15:00:00Z)

mkdir -p "$OUT"/{gh,chat/parts,memo}; cd "$OUT"
json() { awk 'f||/^[\[{]/{f=1;print}'; }   # gws の前置きメッセージを捨てる

# ---------- GitHub ----------
gh search prs --author=$GH_USER --created=$FIRST..$LAST --limit 1000 \
  --json repository,number,title,state,createdAt --jq '.[] | [.repository.nameWithOwner, .number, .state, .createdAt[0:10], .title] | @tsv' > gh/prs.tsv
gh search issues --author=$GH_USER --created=$FIRST..$LAST --limit 1000 \
  --json repository,number,title,state,createdAt --jq '.[] | [.repository.nameWithOwner, .number, .state, .createdAt[0:10], .title] | @tsv' > gh/issues.tsv
# PR の詳細（マージまでの時間・本文・レビュー）はリポジトリ単位で取る
for r in $(cut -f1 gh/prs.tsv | sort -u); do
  gh pr list --repo $r --author $GH_USER --state all --limit 1000 --search "created:$FIRST..$LAST" \
    --json number,title,body,createdAt,mergedAt,state,additions,deletions,mergedBy,reviews \
    | jq -c --arg r "$r" '.[] | . + {repo:$r}' >> gh/prs_detail.jsonl
done
# コミット数は検索が 1000 件で打ち切られるため日別に数える（二次レート制限よけに間隔を空ける）
: > gh/commits_daily.tsv
d=$FIRST
while [[ "$d" < "$NEXT" ]]; do
  n=$(gh api "search/commits?q=author:$GH_USER+author-date:$d&per_page=1" --jq .total_count 2>/dev/null || echo "?")
  print -r -- "$d	$n" >> gh/commits_daily.tsv; sleep 3
  d=$(date -j -v+1d -f %Y-%m-%d "$d" +%Y-%m-%d)
done
gh search commits --author=$GH_USER --author-date=$FIRST..$LAST --limit 1000 --json repository,commit \
  --jq '.[] | [.repository.fullName, .commit.author.date[0:16], (.commit.message|split("\n")[0])] | @tsv' > gh/commits_sample.tsv
# 他者の PR・Issue への自分のコメント、他者の PR（レビュー待ちの確認用）
gh api "search/issues?q=org:$ORG+commenter:$GH_USER+-author:$GH_USER+updated:$FIRST..$LAST&per_page=100" \
  --jq '.items[] | [(.repository_url|split("/")|last), .number, .user.login, .title] | @tsv' > gh/my_comments_on_others.tsv
gh search prs --owner=$ORG --created=$FIRST..$LAST --limit 300 --json repository,number,author,title,state,createdAt \
  --jq '.[] | select(.author.login != "'$GH_USER'") | [.repository.nameWithOwner, .number, .author.login, .state, .createdAt[0:10], .title] | @tsv' > gh/others_prs.tsv
# 緊急・不具合・問い合わせの件（月をまたぐものを含む）。閉じた件は日数、開いている件は月末時点の経過日数
# 件数の多い月は 500 件の上限に当たるため、キーワードを検索クエリ側に入れて語ごとに取る
: > gh/urgent.tsv
for kw in 緊急 不具合 障害 問い合わせ; do
  gh search issues "$kw in:title" --owner=$ORG --involves=$GH_USER --include-prs --closed=$FIRST..$LAST --limit 500 --json repository,number,title,createdAt,closedAt \
    --jq '.[] | [.repository.name, .number, "closed", .createdAt[0:10], .closedAt[0:10], (((.closedAt|fromdate)-(.createdAt|fromdate))/86400|floor), .title] | @tsv' >> gh/urgent.tsv
  gh search issues "$kw in:title" --owner=$ORG --involves=$GH_USER --include-prs --state=open --created="<$NEXT" --limit 500 --json repository,number,title,createdAt \
    --jq '.[] | [.repository.name, .number, "open", .createdAt[0:10], "-", ((("'$NEXT'T00:00:00Z"|fromdate)-(.createdAt|fromdate))/86400|floor), .title] | @tsv' >> gh/urgent.tsv
done
sort -u -o gh/urgent.tsv gh/urgent.tsv
gh search prs --owner=$ORG --review-requested=$GH_USER --state=open --json repository,number,author,title,createdAt \
  --jq '.[] | [.repository.nameWithOwner, .number, .author.login, .createdAt[0:10], .title] | @tsv' > gh/review_requested_open.tsv

# ---------- Google Chat ----------
gws chat spaces list --params '{"pageSize":100}' --page-all --format json 2>/dev/null | json > chat/spaces_all.json
jq -r --arg s "$START_UTC" 'if type=="array" then .[] else .spaces[] end | select((.lastActiveTime // "") >= $s) | [.name, .spaceType, (.displayName // "(DM)")] | @tsv' chat/spaces_all.json > chat/spaces_active.tsv
fetch() {
  gws chat spaces messages list --params "{\"parent\":\"$1\",\"pageSize\":100,\"filter\":\"createTime > \\\"$START_UTC\\\" AND createTime < \\\"$END_UTC\\\"\"}" \
    --page-all --page-limit 50 --format json 2>/dev/null | json \
  | jq -c --arg sp "$1" --arg type "$2" --arg disp "$3" 'if type=="array" then .[] else (.messages[]? // empty) end | {space:$sp, disp:$disp, type:$type, t:.createTime, sender:.sender.name, stype:.sender.type, text:(.text // .formattedText // "")}' > "$4" 2>/dev/null
}
i=0
while IFS=$'\t' read -r name type disp; do
  i=$((i+1)); fetch "$name" "$type" "$disp" "chat/parts/$(printf %03d $i).jsonl" &
  (( i % 8 == 0 )) && wait
done < chat/spaces_active.tsv
wait
cat chat/parts/*.jsonl > chat/messages.jsonl
jst() { python3 -c "
import sys,datetime as d
for l in sys.stdin:
    p=l.rstrip('\n').split('\t')
    t=d.datetime.fromisoformat(p[0].replace('Z','+00:00'))+d.timedelta(hours=9)
    print(t.strftime('%m/%d %H:%M'),*p[1:],sep='\t')" | sort; }
jq -r --arg me $ME 'select(.sender==$me and .type=="SPACE") | [.t, .disp, (.text|gsub("\n";" ")|.[0:400])] | @tsv' chat/messages.jsonl | jst > chat/my_space_msgs.tsv
# DM は相手名が取れないためスペース ID の末尾で区別する。私的な会話を含むので中身は引用しない
jq -r --arg me $ME 'select(.sender==$me and .type!="SPACE") | [.t, (.space|.[7:14]), .type, (.text|gsub("\n";" ")|.[0:250])] | @tsv' chat/messages.jsonl | jst > chat/my_dm_msgs.tsv
jq -r --arg me $ME --arg n "$MY_NAME" 'select(.sender!=$me and .stype=="HUMAN" and (.text|contains($n) or test("亮太"))) | [.t, .disp, (.text|gsub("\n";" ")|.[0:300])] | @tsv' chat/messages.jsonl | jst > chat/mentions_of_me.tsv

# ---------- カレンダー ----------
gws calendar events list --params "{\"calendarId\":\"primary\",\"timeMin\":\"${FIRST}T00:00:00+09:00\",\"timeMax\":\"${NEXT}T00:00:00+09:00\",\"singleEvents\":true,\"orderBy\":\"startTime\",\"maxResults\":2500}" --page-all --format json 2>/dev/null | json \
  | jq -r 'if type=="array" then .[] else .items[]? end | [((.start.dateTime // .start.date)|.[5:16]), (.summary // "(no title)"), ((.attendees // [])|length|tostring), ((.attendees // [])|map(select(.self))|.[0].responseStatus // "-"), ((.organizer.self // false)|tostring)] | @tsv' > calendar.tsv

# ---------- Drive・会議メモ ----------
gws drive files list --params "{\"q\":\"modifiedTime > '$START_UTC' and modifiedTime < '$END_UTC' and trashed=false and (mimeType contains 'google-apps' or mimeType contains 'pdf' or mimeType contains 'officedocument') and not mimeType = 'application/vnd.google-apps.folder'\",\"pageSize\":200,\"fields\":\"files(name,modifiedTime,lastModifyingUser(displayName),owners(displayName))\"}" --format json 2>/dev/null | json \
  | jq -r --arg n "$MY_NAME" '.files[]? | select(.lastModifyingUser.displayName==$n or .owners[0].displayName==$n) | [.modifiedTime[5:10], .name] | @tsv' | sort -u > drive.tsv
gws drive files list --params "{\"q\":\"modifiedTime > '$START_UTC' and modifiedTime < '$END_UTC' and name contains 'Gemini によるメモ' and mimeType = 'application/vnd.google-apps.document' and trashed=false\",\"pageSize\":100,\"fields\":\"files(id,name)\"}" --format json 2>/dev/null | json \
  | jq -r '.files[]|[.id,.name]|@tsv' > memo/list.tsv
# 招待欄以外に本人の名前が出る回数 = 発言・言及の有無（0 なら欠席か無言）
: > memo/attendance.tsv
while IFS=$'\t' read -r id name; do
  f="memo/${id}.txt"
  gws drive files export --params "{\"fileId\":\"$id\",\"mimeType\":\"text/plain\"}" --output "$f" >/dev/null 2>&1 || continue
  print -r -- "$(grep -v '^招待済み' "$f" | grep -c "$MY_NAME")	$name" >> memo/attendance.tsv
done < memo/list.tsv

# ---------- summary ----------
{
  echo "# $MONTH 収集サマリ"
  echo "- PR 作成: $(wc -l < gh/prs.tsv | tr -d ' ') 件（マージ $(jq -s '[.[]|select(.mergedAt)]|length' gh/prs_detail.jsonl)、他者レビュー $(jq -s --arg u $GH_USER '[.[]|.reviews[]?|select(.author.login!=$u)]|length' gh/prs_detail.jsonl) 件、他者マージ $(jq -s --arg u $GH_USER '[.[]|select(.mergedAt and .mergedBy.login!=$u)]|length' gh/prs_detail.jsonl) 件）"
  echo "- Issue 作成: $(wc -l < gh/issues.tsv | tr -d ' ') 件（オープン $(awk -F'\t' '$3=="open"||$3=="OPEN"' gh/issues.tsv | wc -l | tr -d ' ')）"
  echo "- コミット: $(awk -F'\t' '{s+=$2} END{print s}' gh/commits_daily.tsv) 件（日別合計、? は取得失敗の日: $(grep -c '?' gh/commits_daily.tsv)）"
  echo "- リポジトリ別 PR:"; cut -f1 gh/prs.tsv | sort | uniq -c | sort -rn | sed 's/^/  /'
  echo "- 他者 PR へのコメント: $(wc -l < gh/my_comments_on_others.tsv | tr -d ' ') 件 / 自分にレビュー依頼が来て未対応のオープン PR: $(wc -l < gh/review_requested_open.tsv | tr -d ' ') 件"
  echo "- 緊急・不具合・問い合わせの件（7 日以上かかった・開いている）:"; awk -F'\t' '$6>=7{print "  "$1"#"$2" "$3" "$4"→"$5" "$6"日 "$7}' gh/urgent.tsv
  echo "- Chat: 全 $(wc -l < chat/messages.jsonl | tr -d ' ') 件 / 本人 $(jq -c --arg me $ME 'select(.sender==$me)' chat/messages.jsonl | wc -l | tr -d ' ') 件 / 発言者 $(jq -r 'select(.stype=="HUMAN")|.sender' chat/messages.jsonl | sort -u | wc -l | tr -d ' ') 人中 $(jq -r 'select(.stype=="HUMAN")|.sender' chat/messages.jsonl | sort | uniq -c | sort -rn | awk -v me=$ME '{r++} $2==me{print r" 位"}')"
  echo "- 本人の発言（スペース別）:"; jq -r --arg me $ME 'select(.sender==$me) | "\(.disp) [\(.type)]"' chat/messages.jsonl | sort | uniq -c | sort -rn | sed 's/^/  /'
  echo "- 全社スペース（名前に「全社」）での本人発言: $(jq -c --arg me $ME 'select(.sender==$me and (.disp|test("全社")))' chat/messages.jsonl | wc -l | tr -d ' ') 件"
  echo "- カレンダー: $(wc -l < calendar.tsv | tr -d ' ') 件 / 朝礼承諾 $(awk -F'\t' '$2~/朝礼/ && $4=="accepted"' calendar.tsv | wc -l | tr -d ' ')/$(awk -F'\t' '$2~/朝礼/' calendar.tsv | wc -l | tr -d ' ')"
  echo "- 辞退した予定:"; awk -F'\t' '$4=="declined"{print "  "$1" "$2}' calendar.tsv
  echo "- 主催した複数人の予定:"; awk -F'\t' '$5=="true" && $3>1{print "  "$1" "$2" ("$3"名)"}' calendar.tsv
  echo "- 会議メモで本人の名前が出た回数（0 は欠席か無言）:"; sed 's/^/  /' memo/attendance.tsv
} > summary.md
echo "done: $OUT/summary.md"
