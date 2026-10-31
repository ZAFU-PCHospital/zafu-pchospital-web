#!/usr/bin/env bash
# =============================================================================
# pczafu.cn 生产部署脚本 —— 本地构建 + 上传产物（部署 skill 的 7A 路线）
#
# 为什么只用 7A：生产服务器只有 1613MB 内存，服务器原地构建（旧 7B 路线）
# 已实测多次把整机压死（换页占满 2G swap、SSH 失联）。本地构建 + 上传产物
# 没有压死风险，停机窗口只有「停服务 → 换目录 → 起服务」的秒级。
#
# 流程（每一步都有闸门，失败即停并打印恢复指引，绝不自动回滚）：
#   P0  参数与本地环境预检（pnpm / mdbook / node / ssh / 目标提交是否已合并 / 脚本与目标提交一致）
#   P1  服务器侦察（只读：HEAD、工作区、服务、内存、磁盘）
#   P2  变更评估（提交列表 / 迁移风险扫描 / 数据库变更计划 / .env.example）+ 人工确认
#       数据库计划在停机前只读核对 _prisma_migrations：待应用迁移、schema、seed
#   P3  本地构建与打包（git worktree，不碰当前工作区；产出 tar + BUILD_COMMIT）
#       无 .git 的打包构建（tarball / 容器内）需显式指定版本：
#       BUILD_COMMIT_SHA=$(git rev-parse HEAD) pnpm build
#       不指定且取不到 git HEAD 时，后台首页版本显示「未知」（不猜版本）。
#   P4  数据库备份（mysqldump + 闸门：表数≥27、有 INSERT、gzip 完整）
#   P5  上传产物并暂存校验（双端 sha256 对比 + 服务器端解包断言）
#   P6  更新服务器代码与依赖（ff-only、.docs-source、pnpm install、db:generate）
#       服务器 fetch 缺省只等 30s，失败立即走本地 bundle，不再先等 8 分钟
#   P7  【停机】数据库变更（需要时）：迁移 + seed + 迁移前后行数核对
#       纯代码发布跳过本阶段，服务保持运行
#   P8  原子切换产物（.next / public/handbook）并启动服务；纯代码发布在此停机秒级切换
#   P9  冒烟验证（页面 200、新构建 chunk 已生效、可选登录态）
#   P10 总结与回滚指引
#
# 用法（在任意 git 检出内执行）：
#   生产主机地址不进本仓库：先 export DEPLOY_HOST=<user@host>，或每条命令带 --host。
#   bash tools/deploy/deploy-prod.sh                     # 部署 upstream/main 当前指向
#   bash tools/deploy/deploy-prod.sh --sha <提交>        # 部署指定提交（须已合并到远端 main）
#   bash tools/deploy/deploy-prod.sh --rollback          # 只用 .next.old 秒级回滚产物
#   bash tools/deploy/deploy-prod.sh --yes               # 非交互（AI / 自动化兜底用）
#
# 关键参数（均有等价的 DEPLOY_* 环境变量）：
#   --sha <sha>            目标提交；缺省 upstream/main，其次 origin/main
#   --host <user@host>     生产服务器（必填，缺省取 DEPLOY_HOST；可用 ~/.ssh/config 别名）
#   --key <path>           SSH 私钥（缺省 $DEPLOY_SSH_KEY；都没有则用 ssh 默认配置）
#   --base <url>           冒烟验证地址（缺省 https://pczafu.cn）
#   --build-dir <dir>      本地构建目录（缺省 仓库同级 .zafu-deploy-build）
#   --docs-source <dir>    文档源码检出（缺省 仓库内 .docs-source，缺失则自动克隆）；
#                          显式路径也会先 fetch/ff-only，更新失败默认中止
#   --allow-stale-docs     文档源码无法更新时仍继续用当前检出构建（可能发布旧文档）
#   --rebuild              忽略已有产物缓存，强制重新构建
#   --redeploy             允许对服务器当前已部署的同一提交重复部署
#   --yes                  跳过人工确认（停机窗口确认等），非交互环境必须加
#   --allow-risky-migration  确认已读过含 DROP/MODIFY/UPDATE 的迁移 SQL 再放行
#   --allow-env-change       确认服务器 .env 已随 .env.example 更新再放行
#   --allow-schema-without-migration
#       已人工确认 schema 变化与数据库一致（或该变化不涉及数据库）时放行
#   --allow-local-script    当前运行的脚本与目标提交不一致时仍继续（默认拒绝，日志留痕）
#   DEPLOY_SMOKE_QQ / DEPLOY_SMOKE_PASSWORD  可选：冒烟时做登录态验证
#   DEPLOY_FETCH_TIMEOUT / DEPLOY_FETCH_ATTEMPTS
#       服务器主仓库 fetch 的单次超时与尝试次数（缺省 30 秒 × 1 次，失败即走 bundle）
#   DEPLOY_DOCS_FETCH_TIMEOUT / DEPLOY_DOCS_FETCH_ATTEMPTS
#       服务器 .docs-source 的 fetch 参数（缺省 20 秒 × 1 次；失败只告警，不影响 7A 部署）
#   DEPLOY_DOCS_SOURCE_FETCH_ATTEMPTS
#       本地构建用文档源码的 fetch/ff-only 尝试次数（缺省 3；失败默认中止）
#
# 恢复与兜底：
#   · 失败时脚本不自动回滚，会按中断的阶段打印恢复指引（服务在停机前失败都还活着）。
#   · 停机后想回退产物：bash tools/deploy/deploy-prod.sh --rollback（秒级）。
#   · 完整回滚（代码/数据库）见脚本结尾打印的指引与 skill 第 9 节。
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# 基础工具函数与全局状态
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_DIM=""; C_OFF=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s  ✓ %s%s\n' "$C_GREEN" "$*" "$C_OFF"; }
warn() { printf '%s  ! %s%s\n' "$C_YELLOW" "$*" "$C_OFF"; }
note() { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_OFF"; }
die()  { printf '\n%s✗ 中止：%s%s\n' "$C_RED" "$*" "$C_OFF" >&2; exit 1; }

positive_int() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ]; }

SCRIPT_START_SECONDS=$SECONDS
CURRENT_PHASE="0"
PHASE_NAME=""
PHASE_START_SECONDS=$SECONDS
PHASE_TIMINGS=()
TIMINGS_PRINTED=0
PHASE_FAIL_GUIDE=""

finish_phase() {
  if [ -n "$PHASE_NAME" ]; then
    PHASE_TIMINGS+=("P$CURRENT_PHASE|$PHASE_NAME|$((SECONDS - PHASE_START_SECONDS))")
    PHASE_NAME=""
  fi
}

print_phase_timings() {
  [ "${#PHASE_TIMINGS[@]}" -gt 0 ] || return 0
  TIMINGS_PRINTED=1
  say ""
  say "阶段耗时（本地墙钟）："
  local entry num name dur
  if [ "${#PHASE_TIMINGS[@]}" -gt 0 ]; then
    for entry in "${PHASE_TIMINGS[@]}"; do
      IFS='|' read -r num name dur <<< "$entry"
      printf '  %-4s %-40s %5ss\n' "$num" "$name" "$dur"
    done
  fi
  printf '  %-4s %-40s %5ss\n' "合计" "脚本运行" "$((SECONDS - SCRIPT_START_SECONDS))"
  [ -z "${DOWNTIME:-}" ] || say "  停机窗口：${DOWNTIME}s"
  [ "${FETCH_WAIT_SECONDS:-0}" = "0" ] ||
    say "  服务器主仓库 fetch 等待：${FETCH_WAIT_SECONDS}s（尝试 ${FETCH_TRY_COUNT} 次后$([ "${FETCH_OK:-0}" = "1" ] && echo 成功 || echo 切换 bundle)）"
  [ "${DOCS_FETCH_WAIT_SECONDS:-0}" = "0" ] ||
    say "  .docs-source fetch 等待：${DOCS_FETCH_WAIT_SECONDS}s"
}

# 阶段头：$1=阶段号 $2=标题
step() {
  finish_phase
  CURRENT_PHASE="$1"
  PHASE_NAME="$2"
  PHASE_START_SECONDS=$SECONDS
  case "$1" in 7|8|R) NOTIFY_COMMIT="" ;; esac
  printf '\n%s====== [P%s] %s ======%s\n' "$C_BOLD" "$1" "$2" "$C_OFF"
}

# 人工确认点；--yes 时自动放行并留痕
confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "1" ]; then
    warn "自动确认（--yes）：$prompt"
    return 0
  fi
  [ -t 0 ] || die "当前不是交互终端。人工确认点是部署流程的一部分；请在终端运行，或显式加 --yes。"
  local ans=""
  printf '%s❯ %s [y/N] %s' "$C_BOLD" "$prompt" "$C_OFF"
  read -r ans || true
  case "$ans" in
    y|Y|yes|YES) return 0 ;;
    *) die "操作者取消了部署。" ;;
  esac
}

usage() { awk 'NR>1 && /^# ={20,}$/{n++; if(n==2) exit} NR>1{print}' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
SHA_INPUT=""
SSH_HOST="${DEPLOY_HOST:-}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
ASSUME_YES=0; FORCE_REBUILD=0; ALLOW_REDEPLOY=0; DO_ROLLBACK=0
BUILD_DIR_OPT=""; DOCS_DIR_OPT="${DOCS_SOURCE_DIR:-}"; LOG_FILE_OPT="${DEPLOY_LOG:-}"
BASE_URL="${DEPLOY_BASE_URL:-https://pczafu.cn}"
ALLOW_RISKY_MIGRATION="${ALLOW_RISKY_MIGRATION:-0}"
ALLOW_ENV_CHANGE="${ALLOW_ENV_CHANGE:-0}"
ALLOW_SCHEMA_WITHOUT_MIGRATION="${ALLOW_SCHEMA_WITHOUT_MIGRATION:-0}"
ALLOW_STALE_DOCS="${ALLOW_STALE_DOCS:-0}"
ALLOW_LOCAL_SCRIPT="${ALLOW_LOCAL_SCRIPT:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA_INPUT="${2:?--sha 需要参数}"; shift 2 ;;
    --host) SSH_HOST="${2:?--host 需要参数}"; shift 2 ;;
    --key) SSH_KEY="${2:?--key 需要参数}"; shift 2 ;;
    --base) BASE_URL="${2:?--base 需要参数}"; shift 2 ;;
    --build-dir) BUILD_DIR_OPT="${2:?--build-dir 需要参数}"; shift 2 ;;
    --docs-source) DOCS_DIR_OPT="${2:?--docs-source 需要参数}"; shift 2 ;;
    --log) LOG_FILE_OPT="${2:?--log 需要参数}"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --rebuild) FORCE_REBUILD=1; shift ;;
    --redeploy) ALLOW_REDEPLOY=1; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    --allow-risky-migration) ALLOW_RISKY_MIGRATION=1; shift ;;
    --allow-env-change) ALLOW_ENV_CHANGE=1; shift ;;
    --allow-schema-without-migration) ALLOW_SCHEMA_WITHOUT_MIGRATION=1; shift ;;
    --allow-stale-docs) ALLOW_STALE_DOCS=1; shift ;;
    --allow-local-script) ALLOW_LOCAL_SCRIPT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "未知参数：$1" ;;
  esac
done

# 主机地址不硬编码：缺省目标会让任何一次误跑都打在线上，所以必须先显式给出。
[ -n "$SSH_HOST" ] ||
  die "未指定生产服务器：用 --host <user@host> 或 DEPLOY_HOST 环境变量指定（向管理员获取，主机地址不写进公开仓库）"

# ---------------------------------------------------------------------------
# 生产环境常量（与 skill 0 节一致；密钥一律不进本脚本）
# ---------------------------------------------------------------------------
SERVICE="zafu-pchospital-web"
APP_DIR="/opt/zafu-pchospital-web"
BACKUP_DIR="/opt/zafu-pchospital-backups"
DB_CONTAINER="zafu-pchospital-db-greatsql-1"
DB_NAME="zafu_pchospital"
DB_ENV_FILE="/opt/zafu-pchospital-db/.env"
ZAFU_USER="zafu-web"
MIN_TABLES="${DEPLOY_MIN_TABLES:-27}"
FETCH_TIMEOUT="${DEPLOY_FETCH_TIMEOUT:-30}"
FETCH_MAX_ATTEMPTS="${DEPLOY_FETCH_ATTEMPTS:-1}"
DOCS_FETCH_TIMEOUT="${DEPLOY_DOCS_FETCH_TIMEOUT:-20}"
DOCS_FETCH_MAX_ATTEMPTS="${DEPLOY_DOCS_FETCH_ATTEMPTS:-1}"
DOCS_SOURCE_ATTEMPTS="${DEPLOY_DOCS_SOURCE_FETCH_ATTEMPTS:-3}"
# docs-sync 的已发布 SHA；部署换入自己的 handbook 后要让它失效，下一次同步才会重新核对内容。
DOCS_SYNC_STATE="${DOCS_SYNC_STATE_FILE:-/var/lib/docs-sync/deployed-sha}"
for pair in \
  "DEPLOY_FETCH_TIMEOUT=$FETCH_TIMEOUT" \
  "DEPLOY_FETCH_ATTEMPTS=$FETCH_MAX_ATTEMPTS" \
  "DEPLOY_DOCS_FETCH_TIMEOUT=$DOCS_FETCH_TIMEOUT" \
  "DEPLOY_DOCS_FETCH_ATTEMPTS=$DOCS_FETCH_MAX_ATTEMPTS" \
  "DEPLOY_DOCS_SOURCE_FETCH_ATTEMPTS=$DOCS_SOURCE_ATTEMPTS"; do
  positive_int "${pair#*=}" || die "${pair%%=*} 必须是正整数（当前：${pair#*=}）"
done

DOCS_SYNC_STOPPED=0
SERVICE_STOPPED=0
STOP_TS=""
DOWNTIME=""
WT_CREATED=0
BUNDLE_BRANCH=""
DEPLOY_OK=0
FETCH_WAIT_SECONDS=0
FETCH_TRY_COUNT=0
FETCH_OK=""
DOCS_FETCH_WAIT_SECONDS=0

DB_QUERY_OK=0
DB_WORK=0
DB_REASONS=""
DB_PENDING_COUNT=0
DB_APPLIED_COUNT=0
DB_LOCAL_COUNT=0
DB_PENDING_LIST=""
DB_FAILED_LIST=""
DB_DRIFT_LIST=""
SCHEMA_CHANGED=0
SEED_CHANGED=0
PRISMA_CONFIG_CHANGED=0

# ---------------------------------------------------------------------------
# 退出钩子：无论成功失败都要把 docs-sync 定时器放回去，并按阶段打印指引
# ---------------------------------------------------------------------------
remote_restart_docs_sync() {
  if [ "$DOCS_SYNC_STOPPED" = "1" ]; then
    ssh_run_quiet "systemctl start docs-sync.timer 2>/dev/null || true" || true
  fi
}
cleanup_local_bundle_branch() {
  if [ -n "$BUNDLE_BRANCH" ]; then
    git -C "$REPO_ROOT" branch -D "$BUNDLE_BRANCH" >/dev/null 2>&1 || true
  fi
}
on_exit() {
  local code=$?
  set +e # Notification/cleanup must never replace the deployment exit code.
  remote_restart_docs_sync
  cleanup_local_bundle_branch
  if [ "$code" != "0" ] && [ "$CURRENT_PHASE" != "" ]; then
    printf '\n%s--------------------------------------------- %s\n' "$C_RED" "$C_OFF"
    printf '%s✗ 部署在 [P%s] 中断（退出码 %s）。未做自动回滚，按下面指引处理：%s\n' "$C_RED" "$CURRENT_PHASE" "$code" "$C_OFF"
    case "$CURRENT_PHASE" in
      0|1|2) say "  · 服务器尚未做任何变更。修复问题后直接重跑本脚本。";;
      3)     say "  · 本地构建/打包失败，服务器未做任何变更（构建日志见下方 build-*.log 路径）。"
             say "  · 常见原因：本机缺 mdbook（export MDBOOK_BIN=/path/to/mdbook）、.docs-source 缺 theme/。修好重跑。";;
      4)     say "  · 数据库备份闸门未过。先查 /opt/zafu-pchospital-backups 里的 dump 内容与报错，修好重跑（不会动线上数据）。";;
      5)     say "  · 上传或服务器端解包校验失败，服务器尚未改代码。检查 /tmp 空间与网络，重跑即可（会重传）。";;
      6)     say "  · 服务器代码/依赖更新阶段失败：旧产物仍在正常服务（服务从未停）。"
             say "  · 排障：ssh 上去看 git status / pnpm 输出；修好后重跑本脚本。";;
      7)     say "  · ${C_YELLOW}服务已停、迁移可能未完成。${C_OFF}先看上面的 migrate/seed 输出与数据库报错。"
             say "  · 快速恢复旧版站点：ssh 后执行 systemctl start $SERVICE（旧产物还在）。"
             say "  · 数据库备份位于 $BACKUP_DIR（文件名含本次提交短 sha），需要还原见 skill 第 9 节。"
             say "  · 修复后重跑本脚本（migrate 幂等，会继续未完成部分）。";;
      8)     say "  · ${C_YELLOW}服务已停或切换未完成。${C_OFF}看上面输出定位；可先 ssh 检查 journalctl -u $SERVICE -n 50。"
             say "  · 想退回上一版产物：bash tools/deploy/deploy-prod.sh --rollback"
             say "  · 想直接把旧版拉起来：ssh 后 cd $APP_DIR && mv .next.bad .next 2>/dev/null; systemctl start $SERVICE";;
      9)     say "  · 新版已上线但冒烟失败。逐项看上面失败项；若是新构建问题：bash tools/deploy/deploy-prod.sh --rollback";;
      10)    say "  · 收尾阶段失败（不影响站点），常规为权限或清理问题，重跑或手动处理。";;
      R)     say "  · 回滚中断。现场：新版产物在 .next.bad，旧版在 .next（已完成交换时）。"
             say "  · 可重跑：bash tools/deploy/deploy-prod.sh --rollback";;
      *)     say "  · 未知阶段，请人工排查。";;
    esac
    printf '%s---------------------------------------------%s\n\n' "$C_RED" "$C_OFF"
  fi
  finish_phase
  [ "$TIMINGS_PRINTED" = "1" ] || print_phase_timings
  if [ "$DEPLOY_OK" = "1" ] && [ "$WT_CREATED" = "1" ]; then
    git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  fi
  if declare -F notify_deploy_result >/dev/null; then notify_deploy_result "$code"; fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------
# SSH 辅助
# ---------------------------------------------------------------------------
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=3 -o ServerAliveInterval=15)
SSH_OPTS_KEY=()
scp_retry() {
  local f="$1" i=0
  while [ $i -lt 3 ]; do
    if scp "${SSH_OPTS[@]}" "${SSH_OPTS_KEY[@]}" "$f" "$SSH_HOST:/tmp/"; then return 0; fi
    i=$((i+1)); warn "scp 第 $i 次失败，重试…"; sleep 3
  done
  return 1
}
remote() { ssh "${SSH_OPTS[@]}" "${SSH_OPTS_KEY[@]}" "$SSH_HOST" "$@"; }
ssh_run_quiet() { ssh "${SSH_OPTS[@]}" "${SSH_OPTS_KEY[@]}" "$SSH_HOST" "$@" 2>/dev/null || true; }
# 多行脚本走 stdin；调用形式： remote_script <<REMOTE ... REMOTE
remote_script() { ssh "${SSH_OPTS[@]}" "${SSH_OPTS_KEY[@]}" "$SSH_HOST" 'bash -s'; }

# ---------------------------------------------------------------------------
# 停机前数据库变更计划（P2 只读核对；不推断，只按实际差异分类）
# ---------------------------------------------------------------------------
add_db_reason() { DB_REASONS="${DB_REASONS:+$DB_REASONS；}$1"; }

# 只比较 schema 的实质内容：去掉 // 注释后，把缩进、对齐、换行等空白压成单个空格。
# 这样只跑 prisma format 的纯格式变化不会被误判为「schema 有变化但没有迁移」。
schema_fingerprint() {
  git -C "$REPO_ROOT" show "$1:prisma/schema.prisma" 2>/dev/null |
    sed -E 's@(^|[[:space:]])//.*$@@' |
    tr -s '[:space:]' ' ' |
    sed -E 's/^ //; s/ $//' || true
}

assess_db_plan() {
  local local_rows="" db_rows="" name finished rolled
  local applied_names="" failed_names="" rolled_names=""
  DB_QUERY_OK=0; DB_WORK=0; DB_REASONS=""
  DB_PENDING_COUNT=0; DB_APPLIED_COUNT=0; DB_LOCAL_COUNT=0
  DB_PENDING_LIST=""; DB_FAILED_LIST=""; DB_DRIFT_LIST=""
  SCHEMA_CHANGED=0; SEED_CHANGED=0; PRISMA_CONFIG_CHANGED=0

  if [ "$HAVE_OLD" != "1" ]; then
    DB_WORK=1
    add_db_reason "缺少服务器当前提交对象，无法比对变更"
    warn "无法比对 $OLD_SHA..$TARGET_SHA：按“需要数据库阶段”保守处理。"
    return 0
  fi

  if ! git -C "$REPO_ROOT" cat-file -e "$OLD_SHA:prisma/schema.prisma" 2>/dev/null ||
     ! git -C "$REPO_ROOT" cat-file -e "$TARGET_SHA:prisma/schema.prisma" 2>/dev/null; then
    SCHEMA_CHANGED=1
  elif [ "$(schema_fingerprint "$OLD_SHA")" != "$(schema_fingerprint "$TARGET_SHA")" ]; then
    SCHEMA_CHANGED=1
  fi
  if ! git -C "$REPO_ROOT" diff --quiet "$OLD_SHA..$TARGET_SHA" -- prisma/seed.ts prisma/seed 2>/dev/null; then
    SEED_CHANGED=1
  fi
  if ! git -C "$REPO_ROOT" diff --quiet "$OLD_SHA..$TARGET_SHA" -- prisma.config.ts 2>/dev/null; then
    PRISMA_CONFIG_CHANGED=1
  fi

  local_rows="$(git -C "$REPO_ROOT" ls-tree -d --name-only "$TARGET_SHA" prisma/migrations/ 2>/dev/null |
    sed 's#^prisma/migrations/##' | sed '/^[[:space:]]*$/d' || true)"
  DB_LOCAL_COUNT="$(printf '%s\n' "$local_rows" | grep -c . || true)"

  if db_rows="$(remote_script <<'REMOTE'
set -e
set -a; . /opt/zafu-pchospital-db/.env; set +a
docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SELECT CONCAT(migration_name, '|', COALESCE(DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%sZ'), ''), '|', COALESCE(DATE_FORMAT(rolled_back_at, '%Y-%m-%dT%H:%i:%sZ'), '')) FROM _prisma_migrations ORDER BY started_at"
REMOTE
)"; then
    DB_QUERY_OK=1
    db_rows="$(printf '%s' "$db_rows" | tr -d '\r')"
    while IFS='|' read -r name finished rolled; do
      [ -n "$name" ] || continue
      if [ -n "$rolled" ]; then
        rolled_names+="$name"$'\n'
      elif [ -n "$finished" ]; then
        applied_names+="$name"$'\n'
      else
        failed_names+="$name"$'\n'
      fi
    done <<< "$db_rows"

    DB_APPLIED_COUNT="$(printf '%s' "$applied_names" | grep -c . || true)"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if ! grep -Fxq "$name" <<< "$applied_names"; then
        DB_PENDING_LIST+="$name"$'\n'
      fi
    done <<< "$local_rows"
    DB_PENDING_COUNT="$(printf '%s' "$DB_PENDING_LIST" | grep -c . || true)"

    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if ! grep -Fxq "$name" <<< "$local_rows"; then
        DB_DRIFT_LIST+="$name"$'\n'
      fi
    done <<< "$applied_names"

    DB_FAILED_LIST="$(printf '%s%s' "$failed_names" "$rolled_names" | sed '/^[[:space:]]*$/d')"
  else
    DB_QUERY_OK=0
  fi

  say ""
  say "数据库变更计划（停机前只读核对）："
  if [ "$DB_QUERY_OK" = "1" ]; then
    say "  _prisma_migrations：已应用 $DB_APPLIED_COUNT；目标提交迁移目录 $DB_LOCAL_COUNT；待应用 $DB_PENDING_COUNT"
    if [ -n "$DB_PENDING_LIST" ]; then
      say "  待应用迁移："
      printf '%s' "$DB_PENDING_LIST" | sed 's/^/      /'
    elif [ -n "$NEW_MIGS" ]; then
      say "  本次新增的迁移文件均已在数据库应用。"
    fi
    if [ -n "$DB_FAILED_LIST" ]; then
      warn "数据库存在失败或已回滚的迁移记录："
      printf '%s\n' "$DB_FAILED_LIST" | sed 's/^/      /'
    fi
    if [ -n "$DB_DRIFT_LIST" ]; then
      warn "数据库已应用、但目标提交不包含的迁移："
      printf '%s' "$DB_DRIFT_LIST" | sed 's/^/      /'
    fi
  else
    warn "无法读取 _prisma_migrations（数据库不可连、表不存在或权限不足）：按“需要数据库阶段”保守处理。"
  fi
  local new_mig_count
  new_mig_count="$(printf '%s\n' "$NEW_MIGS" | grep -c . || true)"
  say "  schema.prisma 实质变化：$([ "$SCHEMA_CHANGED" = "1" ] && echo 是 || echo 否)；本次新增迁移：$new_mig_count 个；seed 变化：$([ "$SEED_CHANGED" = "1" ] && echo 是 || echo 否)"

  if [ -n "$DB_FAILED_LIST" ]; then
    die "数据库存在失败或已回滚的迁移记录（见上）。先人工用 prisma migrate resolve 处理，再部署；
    不能把 migrate deploy 的失败留到停机窗口里才发现。"
  fi
  if [ -n "$DB_DRIFT_LIST" ]; then
    die "数据库已应用了目标提交里不存在的迁移（见上）。数据库与目标版本不一致，先人工核对。"
  fi

  if [ "$DB_QUERY_OK" != "1" ]; then
    DB_WORK=1
    add_db_reason "无法确认数据库已应用版本"
  fi
  if [ "$DB_PENDING_COUNT" -gt 0 ]; then
    DB_WORK=1
    add_db_reason "待应用迁移 $DB_PENDING_COUNT 个"
  fi
  if [ "$SCHEMA_CHANGED" = "1" ]; then
    if [ -z "$NEW_MIGS" ]; then
      if [ "$ALLOW_SCHEMA_WITHOUT_MIGRATION" != "1" ]; then
        die "prisma/schema.prisma 有实质变化，但目标提交没有新增迁移。
    不能把它当作纯代码发布：请补对应迁移；若已人工确认 schema 与数据库一致（或该变化不涉及数据库），
    用 --allow-schema-without-migration 显式放行。"
      fi
      warn "schema.prisma 有实质变化且没有新增迁移；已用 --allow-schema-without-migration 放行（请确认数据库已一致）。"
    elif [ "$DB_QUERY_OK" != "1" ]; then
      : # 已有“无法确认数据库已应用版本”，P7 会执行 migrate。
    elif [ "$DB_PENDING_COUNT" -gt 0 ]; then
      DB_WORK=1
      add_db_reason "schema.prisma 有变化且新迁移待应用"
    else
      say "  schema 变化已由本次新增迁移覆盖（迁移已应用）。"
    fi
  fi
  if [ "$SEED_CHANGED" = "1" ]; then
    DB_WORK=1
    add_db_reason "seed 有变化"
  fi
  if [ "$PRISMA_CONFIG_CHANGED" = "1" ]; then
    DB_WORK=1
    add_db_reason "prisma.config.ts 有变化"
  fi

  if [ "$DB_WORK" = "1" ]; then
    warn "本次需要停机执行数据库工作：$DB_REASONS。"
  elif [ "$SCHEMA_CHANGED" = "1" ] && [ -n "$NEW_MIGS" ]; then
    ok "数据库阶段可跳过：schema 变化已由本次新增迁移覆盖（迁移已应用）；P7 将跳过 migrate/seed/行数核对。"
  elif [ "$SCHEMA_CHANGED" = "1" ]; then
    ok "数据库阶段可跳过：schema 变化已人工确认无需数据库操作；P7 将跳过 migrate/seed/行数核对。"
  else
    ok "纯代码发布：无待应用迁移、无 schema/seed 变化；P7 将跳过 migrate/seed/行数核对。"
  fi
}

# ---------------------------------------------------------------------------
# [R] 回滚模式：用服务器上的 .next.old / public/handbook.old 换回上一版产物
#     只动产物目录与 systemd；不动数据库、不动代码检出。秒级。
# ---------------------------------------------------------------------------
rollback_flow() {
  step R "回滚到上一版产物（秒级；不动数据库与代码检出）"
  if verify_runtime_commit; then NOTIFY_PREVIOUS="$NOTIFY_COMMIT"; fi
  NOTIFY_COMMIT=""
  command -v ssh >/dev/null 2>&1 || die "缺少 ssh 命令。"
  command -v curl >/dev/null 2>&1 || die "缺少 curl 命令。"
  say "服务器：$SSH_HOST"

  remote_script <<'REMOTE'
set -e
cd /opt/zafu-pchospital-web
echo "当前 HEAD：$(git log --oneline -1 | cat)"
echo "当前 BUILD_ID：$(cat .next/BUILD_ID 2>/dev/null || echo 缺失)"
test -d .next.old || { echo "✗ 没有 .next.old —— 服务器上没有可回滚的上一版产物（首次 7A 部署之前或已被清理）"; exit 3; }
ls -d public/handbook.old 2>/dev/null || echo "（没有 public/handbook.old，只回滚 .next）"
REMOTE

  confirm "确认回滚到 .next.old 里的上一版产物？会停服数秒。"

  DOCS_SYNC_STOPPED=1
  remote_script <<'REMOTE'
set -e
cd /opt/zafu-pchospital-web
systemctl stop docs-sync.timer docs-sync.service 2>/dev/null || true
systemctl stop zafu-pchospital-web
rm -rf .next.bad public/handbook.bad
mv .next .next.bad
mv .next.old .next
if [ -d public/handbook.old ]; then
  mv public/handbook public/handbook.bad
  mv public/handbook.old public/handbook
fi
chown -R zafu-web:zafu-web .next public/handbook 2>/dev/null || true
systemctl start zafu-pchospital-web
for i in $(seq 1 20); do
  sleep 1
  systemctl is-active --quiet zafu-pchospital-web && break
done
systemctl is-active zafu-pchospital-web
code=""
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3311/ || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "回滚后站点内部状态码：$code（BUILD_ID=$(cat .next/BUILD_ID 2>/dev/null || echo 缺失)）"
REMOTE

  RB_DOCS_STATE="$(remote_script <<REMOTE
if rm -f "$DOCS_SYNC_STATE" 2>/dev/null; then echo INVALIDATED; else echo FAILED; fi
REMOTE
)"
  if [ "$RB_DOCS_STATE" = "FAILED" ]; then
    warn "回滚后未能删除 docs-sync 状态（$DOCS_SYNC_STATE）；请手工检查，revision 标记会在下次同步兜底。"
  fi

  say "外部验证…"
  NOTIFY_SMOKE=unknown
  local RB_BAD=0 code
  for p in / /handbook/; do
    code="$(curl -sL --max-time 20 -o /dev/null -w '%{http_code}' "$BASE_URL$p" || echo 000)"
    if [ "$code" = "200" ]; then ok "$p -> 200"; else warn "$p -> $code"; RB_BAD=1; fi
  done
  if [ "$RB_BAD" = "1" ]; then NOTIFY_SMOKE=failed; else NOTIFY_SMOKE=passed; fi

  remote_script <<'REMOTE'
systemctl start docs-sync.timer 2>/dev/null || true
REMOTE
  DOCS_SYNC_STOPPED=0

  if [ "$RB_BAD" = "1" ]; then
    die "回滚后的站点外部验证未通过。现场：新版产物在 .next.bad，旧版在 .next；排查 journalctl -u zafu-pchospital-web。"
  fi
  ok "产物已回滚，站点正常。"
  say "  注意：回滚只换了产物 —— 服务器代码检出仍是最新提交，数据库迁移不回滚（前向迁移规矩）。"
  say "  docs-sync 状态已失效：下次同步会按 gh-pages 重新发布文档（回滚的 handbook.old 可能被新文档替换）。"
  say "  如需连代码一起退（git reset 属破坏性操作），按 skill 第 9 节人工处理。"
  say ""
  say "${C_BOLD}ROLLBACK RESULT: SUCCESS${C_OFF}"
  NOTIFY_SMOKE=passed
  if verify_runtime_commit; then NOTIFY_RESULT=rollback; else NOTIFY_RESULT=unknown; fi
}

# ---------------------------------------------------------------------------
# [P0] 本地环境预检
# ---------------------------------------------------------------------------
step 0 "参数与本地环境预检"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] || die "找不到 git 仓库：脚本应放在仓库的 tools/deploy/ 下运行。"
source "$SCRIPT_DIR/notify-result.sh"

LOG_FILE="${LOG_FILE_OPT:-${TMPDIR:-/tmp}/pczafu-deploy-$(date +%Y%m%d-%H%M%S).log}"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
exec > >(tee "$LOG_FILE") 2>&1

say "${C_BOLD}pczafu.cn 生产部署（本地构建 + 上传产物）${C_OFF}"
say "日志文件：$LOG_FILE"
say "服务器：  $SSH_HOST"

[ -n "$SSH_KEY" ] && { [ -f "$SSH_KEY" ] || die "SSH 私钥不存在：$SSH_KEY（用 --key 或 DEPLOY_SSH_KEY 指定）"; SSH_OPTS_KEY=(-i "$SSH_KEY"); }

for c in git ssh scp tar curl sha256sum tee; do
  command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
done

# Git Bash（MSYS）下 GNU tar 会把 "E:/…" 当远程主机名解析，导致打包/校验失败
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) export TAR_OPTIONS="--force-local" ;; esac

# 回滚模式只需要 ssh/curl，在工具检查后立即分流（不再要求 node/mdbook/网络 fetch）
if [ "$DO_ROLLBACK" = 1 ]; then
  rollback_flow
  exit 0
fi

command -v node >/dev/null 2>&1 || die "缺少命令：node（本地构建需要）"

NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || die "Node 版本过低（$(node --version)），构建需要 ^20.19 || ^22.12 || >=24.0"

if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then
  PNPM=(pnpm)
elif corepack pnpm --version >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  die "找不到可用的 pnpm（试过 pnpm 与 corepack pnpm）。先 corepack enable 或安装 pnpm。"
fi
ok "pnpm：${PNPM[*]} $("${PNPM[@]}" --version 2>/dev/null | tail -1)"

MDBOOK_BIN="${MDBOOK_BIN:-mdbook}"
command -v "$MDBOOK_BIN" >/dev/null 2>&1 || die "找不到 mdbook（或用 MDBOOK_BIN 指定路径）。参考：https://github.com/rust-lang/mdBook/releases"
MDBOOK_VERSION="$("$MDBOOK_BIN" --version 2>/dev/null || echo unknown)"
ok "mdbook：$MDBOOK_VERSION（$MDBOOK_BIN）"

say "拉取远端引用（git fetch --all --prune）…"
git -C "$REPO_ROOT" fetch --all --prune || die "本地 git fetch 失败（网络？），无法确认目标提交已合并。"

if [ -n "$SHA_INPUT" ]; then
  TARGET_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${SHA_INPUT}^{commit}" 2>/dev/null)" || die "本地找不到提交 $SHA_INPUT（先 git fetch）"
  TARGET_DESC="--sha $SHA_INPUT"
else
  TARGET_REF=""
  for cand in upstream/main origin/main; do
    if git -C "$REPO_ROOT" rev-parse --verify --quiet "$cand" >/dev/null; then TARGET_REF="$cand"; break; fi
  done
  [ -n "$TARGET_REF" ] || die "本地没有 upstream/main 或 origin/main 引用；请确认远端配置。"
  TARGET_SHA="$(git -C "$REPO_ROOT" rev-parse "$TARGET_REF")"
  TARGET_DESC="$TARGET_REF"
fi

# 部署闸门：目标必须已合并到某个远端 main（不允许部署未合并的分支）
if ! git -C "$REPO_ROOT" for-each-ref --format='%(refname)' --contains "$TARGET_SHA" 'refs/remotes/*/main' | grep -q .; then
  die "提交 $TARGET_SHA 不在任何远端 main 上（未合并）。按规矩不部署未合并的提交；等 PR 合并且 fetch 后再来。"
fi
ok "目标提交：$(git -C "$REPO_ROOT" log --oneline -1 "$TARGET_SHA")（来自 $TARGET_DESC）"

# 部署脚本硬校验：当前运行的脚本必须与目标提交一致。主工作区的旧脚本或未提交 patch
# 不能用来部署新目标；默认在 P0 中止，确需例外时用 --allow-local-script 显式放行。
if ! git -C "$REPO_ROOT" diff --quiet "$TARGET_SHA" -- tools/deploy/deploy-prod.sh; then
  if [ "$ALLOW_LOCAL_SCRIPT" = "1" ]; then
    warn "当前运行的 deploy-prod.sh 与目标提交 $TARGET_SHA 不一致；已用 --allow-local-script 显式放行（日志留痕）"
  else
    die "当前运行的 deploy-prod.sh 与目标提交 $TARGET_SHA 不一致；请在该提交的干净 worktree 运行；确需例外时用 --allow-local-script 显式放行"
  fi
fi

BUILD_DIR="${BUILD_DIR_OPT:-$(dirname "$REPO_ROOT")/.zafu-deploy-build}"
WT="$BUILD_DIR/worktree"
ART="$BUILD_DIR/pc-artifact-$TARGET_SHA.tar.gz"

say ""
say "  仓库：      $REPO_ROOT"
say "  构建目录：  $BUILD_DIR"
say "  产物路径：  $ART"
say "  冒烟地址：  $BASE_URL"
say "  交互模式：  $([ "$ASSUME_YES" = 1 ] && echo '自动确认（--yes）' || echo '人工逐步确认')"

# ---------------------------------------------------------------------------
# [P1] 服务器侦察（只读）
# ---------------------------------------------------------------------------
step 1 "服务器侦察（只读）"

if ! SSH_PROBE="$(remote true 2>&1)"; then
  printf '%s\n' "$SSH_PROBE"
  case "$SSH_PROBE" in
    *"Host key verification failed"*)
      die "这是首次连接该服务器：先在终端执行一次  ssh $([ -n "$SSH_KEY" ] && printf -- '-i %s ' "$SSH_KEY")$SSH_HOST true  并回答 yes 接受主机指纹，然后重跑本脚本。" ;;
    *"Permission denied"*|*"publickey"*)
      die "SSH 认证失败：检查 --key / DEPLOY_SSH_KEY 指向的私钥，以及服务器 authorized_keys。" ;;
    *"timed out"*|*"Connection refused"*|*"No route"*)
      die "无法连接 $SSH_HOST：检查本机网络与服务器安全组。" ;;
    *) die "SSH 预检失败（见上方输出）。" ;;
  esac
fi
ok "SSH 连接正常。"

RECON_OUT="$(remote_script <<'REMOTE'
set -e
git config --global --add safe.directory /opt/zafu-pchospital-web
git config --global --add safe.directory /opt/zafu-pchospital-web/.docs-source
cd /opt/zafu-pchospital-web
echo "OLD_SHA=$(git rev-parse HEAD)"
echo "OLD_LOG=$(git log --oneline -1 | cat)"
echo "--GIT-STATUS--"
git status --porcelain | grep -vE '^\?\? (\.next\.old/|\.next\.bad/|public/handbook\.old/|public/handbook\.bad/|public/handbook\.prev/)' || true
echo "--END-GIT-STATUS--"
echo "SVC=$(systemctl is-active zafu-pchospital-web 2>/dev/null || true)"
echo "DOCSYNC=$(systemctl is-active docs-sync.timer 2>/dev/null || true)"
echo "MEM=$(free -m | sed -n '2p')"
echo "DISK=$(df -P -h /opt | tail -1)"
echo "DB=$(docker ps --format '{{.Names}}' | grep -c zafu-pchospital-db-greatsql-1 || true)"
echo "TOOLS=node $(node -v 2>/dev/null || echo missing) | pnpm $(pnpm -v 2>/dev/null || echo missing) | $(mdbook --version 2>/dev/null || echo 'mdbook missing')"
ls -d .next.old public/handbook.old 2>/dev/null | sed 's/^/OLDCOPY=/' || echo "OLDCOPY=none"
REMOTE
)"
printf '%s\n' "$RECON_OUT"

OLD_SHA="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^OLD_SHA=//p')"
[ -n "$OLD_SHA" ] || die "侦察输出异常：没有取到服务器 HEAD（见上方输出）。"
OLD_LOG="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^OLD_LOG=//p')"
if verify_runtime_commit; then NOTIFY_PREVIOUS="$NOTIFY_COMMIT"; fi

DIRTY="$(printf '%s\n' "$RECON_OUT" | sed -n '/^--GIT-STATUS--$/,/^--END-GIT-STATUS--$/{/^--/d;p}' | sed '/^[[:space:]]*$/d')"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY"
  die "服务器工作区有预期外的未提交改动（白名单只有 .next.old/、.next.bad/、public/handbook.old/、public/handbook.bad/、public/handbook.prev/）。
    先人工确认这些改动是什么（可能是别人正在改的东西），处理后再部署。"
fi
ok "服务器工作区干净（只有预期的部署副本）。"
note "服务器：$OLD_LOG"

SVC_STATE="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^SVC=//p')"
DOCSYNC_STATE="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^DOCSYNC=//p')"
MEMLINE="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^MEM=//p')"
DISKLINE="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^DISK=//p')"
DB_RUNNING="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^DB=//p')"
TOOLSLINE="$(printf '%s\n' "$RECON_OUT" | sed -n 's/^TOOLS=//p')"
say "  内存：$MEMLINE"
say "  磁盘：$DISKLINE"
say "  运行时：$TOOLSLINE"

[ "$DB_RUNNING" = "1" ] || die "数据库容器 zafu-pchospital-db-greatsql-1 未在运行：备份与迁移都需要它。先排查数据库，再部署。"
AVAIL="$(printf '%s' "$DISKLINE" | awk '{print $4}')"
case "$AVAIL" in
  *M) die "/opt 可用空间过小（$AVAIL），不足以放备份与产物。先清理磁盘。" ;;
  *) ok "数据库容器在运行；磁盘可用 $AVAIL。" ;;
esac

if [ "$SVC_STATE" != "active" ]; then
  warn "线上服务当前不是 active（$SVC_STATE）——通常是上次部署中断留下的状态。"
  confirm "继续部署？（脚本会在停机阶段把服务带起来）"
fi
if [ "$DOCSYNC_STATE" != "active" ]; then
  warn "docs-sync.timer 不是 active（$DOCSYNC_STATE），部署仍可继续，脚本会尝试恢复它。"
fi

# ---------------------------------------------------------------------------
# [P2] 变更评估与计划确认
# ---------------------------------------------------------------------------
step 2 "变更评估与计划确认"

say "生产现在：$OLD_SHA（$OLD_LOG）"
say "本次目标：$TARGET_SHA（$(git -C "$REPO_ROOT" log --oneline -1 "$TARGET_SHA")）"

if [ "$OLD_SHA" = "$TARGET_SHA" ]; then
  if [ "$ALLOW_REDEPLOY" != "1" ]; then
    die "服务器上已经是这个提交（$OLD_SHA），无需部署；如确要重复部署同一版本，加 --redeploy。"
  fi
  warn "--redeploy：对同一提交重复部署。"
fi

HAVE_OLD=0
if git -C "$REPO_ROOT" cat-file -e "${OLD_SHA}^{commit}" 2>/dev/null; then HAVE_OLD=1; fi

if [ "$HAVE_OLD" = "1" ] && [ "$OLD_SHA" != "$TARGET_SHA" ]; then
  N_COMMITS="$(git -C "$REPO_ROOT" rev-list --count "$OLD_SHA..$TARGET_SHA")"
  say ""
  say "本次包含 $N_COMMITS 个提交："
  git -C "$REPO_ROOT" log --oneline "$OLD_SHA..$TARGET_SHA" | head -40 | sed 's/^/    /'
else
  warn "本地没有服务器当前提交（$OLD_SHA）的对象，跳过提交列表 —— 请人工确认目标提交内容（本机 git log $TARGET_SHA -5）。"
fi

# —— 迁移风险评估 ——
RISKY_MIG=0
NEW_MIGS=""
if [ "$HAVE_OLD" = "1" ]; then
  NEW_MIGS="$(git -C "$REPO_ROOT" diff --name-only --diff-filter=A "$OLD_SHA..$TARGET_SHA" -- 'prisma/migrations/*/migration.sql')"
fi
if [ -n "$NEW_MIGS" ]; then
  say ""
  say "新增迁移："
  printf '%s\n' "$NEW_MIGS" | sed 's/^/    /'
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # ON UPDATE / ON DELETE 是外键引用动作（CASCADE/RESTRICT），不是数据修改语句，排除
    HITS="$(git -C "$REPO_ROOT" show "$TARGET_SHA:$f" | grep -nEi '(^|[^a-z])(drop|modify|change|truncate|update)([^a-z]|$)' | grep -viE 'ON (UPDATE|DELETE)' || true)"
    if [ -n "$HITS" ]; then
      RISKY_MIG=1
      warn "「$f」里出现风险关键字："
      printf '%s\n' "$HITS" | head -20 | sed 's/^/      /'
    fi
  done <<MIGLIST
$NEW_MIGS
MIGLIST
  if [ "$RISKY_MIG" = "1" ] && [ "$ALLOW_RISKY_MIGRATION" != "1" ]; then
    die "迁移含 DROP / MODIFY / CHANGE / TRUNCATE / UPDATE 等风险语句。
    按规矩先人工读完整 SQL、确认影响，再以 --allow-risky-migration 放行。"
  elif [ "$RISKY_MIG" = "1" ]; then
    warn "--allow-risky-migration：已声明人工看过上面的风险语句。"
  else
    ok "迁移经扫描为纯增量（无 DROP/MODIFY/CHANGE/TRUNCATE/UPDATE）。"
  fi
elif [ "$HAVE_OLD" = "1" ]; then
  say "本次没有新增迁移文件；数据库是否还有历史待应用迁移，以接下来 P2 的实际版本核对为准。"
else
  warn "无法比对迁移列表（缺旧提交对象）；请人工确认本次是否带迁移。"
fi

# —— 环境变量变化（只认变量行；纯注释改动不算）——
ENV_CHANGED=0
if [ "$HAVE_OLD" = "1" ] && ! git -C "$REPO_ROOT" diff --quiet "$OLD_SHA..$TARGET_SHA" -- .env.example 2>/dev/null; then
  ENV_VAR_DIFF="$(git -C "$REPO_ROOT" diff "$OLD_SHA..$TARGET_SHA" -- .env.example | grep -E '^[+-][A-Za-z_][A-Za-z0-9_]*=' || true)"
  if [ -n "$ENV_VAR_DIFF" ]; then
    ENV_CHANGED=1
    warn ".env.example 的变量行有变化（新增环境变量必须先写进服务器 /opt/zafu-pchospital-web/.env）："
    printf '%s\n' "$ENV_VAR_DIFF" | head -40 | sed 's/^/      /'
  else
    say ".env.example 只有注释/说明变化，没有变量行增减 —— 无需改服务器 .env。"
  fi
fi
if [ "$ENV_CHANGED" = "1" ] && [ "$ALLOW_ENV_CHANGE" != "1" ]; then
  die "先按上面的 diff 把新变量写进服务器 .env，再重跑本脚本；
    若确认服务器 .env 已是最终状态，用 --allow-env-change 放行。"
fi

if [ "$HAVE_OLD" = "1" ] && ! git -C "$REPO_ROOT" diff --quiet "$OLD_SHA..$TARGET_SHA" -- pnpm-lock.yaml 2>/dev/null; then
  say "lockfile 有变化：服务器会执行 pnpm install --frozen-lockfile + db:generate（P6）。"
fi

assess_db_plan

if [ "$DB_WORK" = "1" ]; then
  DB_PLAN_LABEL="需要（$DB_REASONS）"
elif [ "$SCHEMA_CHANGED" = "1" ] && [ -n "$NEW_MIGS" ]; then
  DB_PLAN_LABEL="跳过（新迁移已应用）"
elif [ "$SCHEMA_CHANGED" = "1" ]; then
  DB_PLAN_LABEL="跳过（已人工确认 schema）"
else
  DB_PLAN_LABEL="跳过（纯代码发布）"
fi
say ""
ok "评估完成。接下来：本地构建（数分钟）→ 备份 → 上传 → 更新代码 → 数据库阶段：$DB_PLAN_LABEL → 切换 → 冒烟。"
confirm "按以上计划开始部署？（本地构建数分钟；数据库阶段：$DB_PLAN_LABEL；停机窗口为数据库阶段与切换阶段的秒级停机）"

# ---------------------------------------------------------------------------
# [P3] 本地构建与打包（服务器完全不动；构建耗时在停机窗口之外）
# ---------------------------------------------------------------------------
step 3 "本地构建与打包（服务器不动）"

mkdir -p "$BUILD_DIR"
git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"
git -C "$REPO_ROOT" worktree prune 2>/dev/null || true

# —— 文档源码解析（本地构建必须带 theme/pc-hospital.css|js）——
DOCS_ENV=()
DOCS_SRC=""
if [ -n "$DOCS_DIR_OPT" ]; then
  [ -d "$DOCS_DIR_OPT" ] || die "--docs-source 指向的目录不存在：$DOCS_DIR_OPT"
  DOCS_SRC="$DOCS_DIR_OPT"
elif [ -d "$REPO_ROOT/.docs-source" ]; then
  DOCS_SRC="$REPO_ROOT/.docs-source"
fi

ensure_docs_source_current() {
  local src="$1" attempt
  if ! git -C "$src" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [ "$ALLOW_STALE_DOCS" = "1" ]; then
      warn "文档源码不是 git 检出，无法确认是否最新；--allow-stale-docs 放行：$src"
      return 0
    fi
    die "文档源码不是 git 检出，无法确认是否最新（$src）。请传入最新检出，或加 --allow-stale-docs。"
  fi
  say "更新本地文档源码（$src）…"
  for attempt in $(seq 1 "$DOCS_SOURCE_ATTEMPTS"); do
    if GIT_TERMINAL_PROMPT=0 git -C "$src" fetch origin main --quiet 2>/dev/null &&
       git -C "$src" merge --ff-only origin/main >/dev/null 2>&1; then
      ok "文档源码已更新：$(git -C "$src" log --oneline -1 | cat)"
      return 0
    fi
    warn "文档源码更新第 ${attempt}/${DOCS_SOURCE_ATTEMPTS} 次失败（网络或本地改动？）"
    if [ "$attempt" -lt "$DOCS_SOURCE_ATTEMPTS" ]; then sleep 2; fi
  done
  if [ "$ALLOW_STALE_DOCS" = "1" ]; then
    warn "文档源码未能更新；--allow-stale-docs 放行，使用当前检出构建（可能不是最新文档）。"
    return 0
  fi
  die "文档源码未能更新到 origin/main（$src）。为避免发布旧文档，已中止；确认要用当前快照时加 --allow-stale-docs。"
}

DOCS_REV=""
if [ -n "$DOCS_SRC" ]; then
  ensure_docs_source_current "$DOCS_SRC"
  if [ ! -f "$DOCS_SRC/theme/pc-hospital.css" ] || [ ! -f "$DOCS_SRC/theme/pc-hospital.js" ]; then
    die "文档源码缺 theme/pc-hospital.css|js（$DOCS_SRC）—— 检出太旧，不能用于构建。更新它或换 --docs-source。"
  fi
  DOCS_REV="$(git -C "$DOCS_SRC" rev-parse HEAD 2>/dev/null || true)"
  DOCS_ENV=(DOCS_SOURCE_DIR="$DOCS_SRC" DOCS_REVISION="${DOCS_REV:-unknown}")
  ok "文档源码：$DOCS_SRC（revision $(git -C "$DOCS_SRC" rev-parse --short HEAD 2>/dev/null || echo local)）"
else
  warn "未发现 .docs-source：构建时 tools/build-docs.mjs 会浅克隆文档仓库（需要能访问 GitHub）。"
fi

BUILD_ID=""
CHUNK_PATH=""
ART_SHA256=""
ART_DOCS_REV=""
if [ -f "$ART" ]; then
  ART_DOCS_REV="$(tar -xzOf "$ART" BUILD_COMMIT 2>/dev/null | sed -n 's/^docs_revision=//p' | tr -d '\r\n' || true)"
fi

if [ -f "$ART" ] && [ "$FORCE_REBUILD" != "1" ] && [ -n "$DOCS_REV" ] && [ "$ART_DOCS_REV" = "$DOCS_REV" ]; then
  warn "发现同提交且同文档修订的已有产物，跳过构建：$ART（如需按现在的文档状态重建，加 --rebuild）"
  BUILD_ID="$(tar -xzOf "$ART" .next/BUILD_ID 2>/dev/null | tr -d '\r\n' || true)"
  [ -n "$BUILD_ID" ] || die "已有产物损坏（读不出 .next/BUILD_ID）：删掉它重跑，或加 --rebuild。"
  ART_SHA256="$(sha256sum "$ART" | awk '{print $1}')"
else
  if [ -f "$ART" ] && [ "$FORCE_REBUILD" != "1" ]; then
    warn "已有产物与当前文档源码不一致（缓存 docs=${ART_DOCS_REV:-unknown}，当前 ${DOCS_REV:-auto/unknown}），重新构建。"
  fi
  say "创建独立构建 worktree（不碰当前工作区，本地未提交改动不受影响）…"
  git -C "$REPO_ROOT" worktree add --detach "$WT" "$TARGET_SHA" >/dev/null
  WT_CREATED=1
  if [ -f "$REPO_ROOT/.env" ]; then cp -f "$REPO_ROOT/.env" "$WT/.env"; else warn "本机没有 .env —— 构建将缺配置（很可能失败），先补一份再重跑。"; fi
  if [ -f "$REPO_ROOT/.env.local" ]; then cp -f "$REPO_ROOT/.env.local" "$WT/.env.local"; fi

  say "安装依赖（worktree 首次安装约 1-2 分钟）…"
  if ! ( cd "$WT" && "${PNPM[@]}" install --frozen-lockfile --reporter=append-only ); then
    die "worktree 依赖安装失败（服务器未做任何变更）。"
  fi

  BUILD_LOG="$BUILD_DIR/build-$TARGET_SHA.log"
  say "构建 pnpm build（含站内文档），日志：$BUILD_LOG"
  # 不用 env 前缀：个别开发机 PATH 里有自造的 env 脚本，会把整条命令静默吞掉
  if ! ( cd "$WT" && export NEXT_TELEMETRY_DISABLED=1 MDBOOK_BIN="$MDBOOK_BIN" "${DOCS_ENV[@]}" && "${PNPM[@]}" build ) >"$BUILD_LOG" 2>&1; then
    tail -40 "$BUILD_LOG" | sed 's/^/    /' || true
    die "本地构建失败（服务器未做任何变更）。完整日志：$BUILD_LOG"
  fi
  grep -E "Compiled successfully|Generating static pages|Done in" "$BUILD_LOG" | tail -4 | sed 's/^/    /' || true
  if grep -nEi 'out of memory|failed to compile|build error occurred' "$BUILD_LOG" >/dev/null; then
    grep -nEi 'out of memory|failed to compile|build error occurred' "$BUILD_LOG" | head -5 | sed 's/^/    /'
    die "构建日志出现失败关键字（完整日志：$BUILD_LOG）。"
  fi

  BUILD_ID="$(cat "$WT/.next/BUILD_ID" 2>/dev/null | tr -d '\r\n')"
  [ -n "$BUILD_ID" ] || die "构建产物缺少 .next/BUILD_ID（看日志：$BUILD_LOG）。"
  [ -f "$WT/public/handbook/index.html" ] || die "构建产物缺少 public/handbook/index.html —— 站内文档没有构建出来。"
  if grep -q "Route (app)" "$BUILD_LOG"; then ok "构建成功：完整路由表 + BUILD_ID=$BUILD_ID + 站内文档齐。"; else warn "构建日志没有路由表行，人工看一眼日志尾部。"; fi

  CHUNK_PATH="$(grep -rhoE '/_next/static/chunks/[A-Za-z0-9_.~-]+\.js' "$WT/.next/server/app" 2>/dev/null | head -1 || true)"

  say "打包产物（剔除 .next/cache）…"
  {
    echo "commit=$TARGET_SHA"
    echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "node=$(node -v)"
    echo "mdbook=$MDBOOK_VERSION"
    echo "build_id=$BUILD_ID"
    echo "docs_revision=${DOCS_REV:-auto/unknown}"
  } > "$BUILD_DIR/BUILD_COMMIT"
  tar -czf "$ART" --exclude='.next/cache' -C "$WT" .next public/handbook -C "$BUILD_DIR" BUILD_COMMIT
  CACHE_N="$(tar -tzf "$ART" | grep -c '\.next/cache' || true)"
  [ "$CACHE_N" = "0" ] || die "打包异常：产物里含 .next/cache（$CACHE_N 项）。"
  # grep -c（而非 -q）：-q 命中即退出会让 tar 收到 SIGPIPE，在 set -o pipefail 下被误判为失败
  tar -tzf "$ART" | grep -c '\.next/BUILD_ID' >/dev/null || die "打包异常：产物里没有 .next/BUILD_ID。"
  tar -tzf "$ART" | grep -c 'public/handbook/index.html' >/dev/null || die "打包异常：产物里没有 public/handbook/index.html。"
  ART_SHA256="$(sha256sum "$ART" | awk '{print $1}')"
fi

ART_SIZE="$(ls -lh "$ART" | awk '{print $5}')"
ok "产物就绪：$ART（$ART_SIZE，sha256 ${ART_SHA256:0:12}…）"

# ---------------------------------------------------------------------------
# [P4] 数据库备份（闸门：表数 / INSERT / 体积 / gzip 完整性）
# ---------------------------------------------------------------------------
step 4 "数据库备份与闸门校验"

SHORT_SHA="${TARGET_SHA:0:12}"
say "全量备份（mysqldump + gzip；'PROCESS privilege' 的告警无害）…"
BACKUP_OUT="$(remote_script <<REMOTE
set -eo pipefail
set -a; . $DB_ENV_FILE; set +a
mkdir -p $BACKUP_DIR && chmod 700 $BACKUP_DIR
TS=\$(date +%Y%m%d-%H%M%S)
OUT=$BACKUP_DIR/zafu_pchospital-\$TS-$SHORT_SHA.sql.gz
docker exec $DB_CONTAINER mysqldump -uroot -p"\$GREATSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --default-character-set=utf8mb4 $DB_NAME | gzip -6 > "\$OUT"
chmod 600 "\$OUT"
gzip -t "\$OUT"
TABLES=\$(zcat "\$OUT" | grep -c "^CREATE TABLE" || true)
INSERTS=\$(zcat "\$OUT" | grep -c "^INSERT INTO" || true)
SIZE=\$(stat -c%s "\$OUT")
echo "\$OUT" > $BACKUP_DIR/LAST_PRE_$SHORT_SHA.txt
echo "BACKUP_FILE=\$OUT"
echo "BACKUP_TABLES=\$TABLES"
echo "BACKUP_INSERTS=\$INSERTS"
echo "BACKUP_SIZE=\$SIZE"
REMOTE
)"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^BACKUP_FILE=//p')"
B_TABLES="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^BACKUP_TABLES=//p')"
B_INSERTS="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^BACKUP_INSERTS=//p')"
B_SIZE="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^BACKUP_SIZE=//p')"
note "备份文件：${BACKUP_FILE:-（未取到）}"

[ -n "$BACKUP_FILE" ] || die "没有取到备份文件路径（见上方输出）。"
if ! [ "${B_TABLES:-0}" -ge "$MIN_TABLES" ] 2>/dev/null; then
  die "备份闸门失败：只 dump 出 ${B_TABLES:-0} 张表（应 ≥ $MIN_TABLES）。删掉 $BACKUP_FILE 后重做，不要拿它当备份。"
fi
if ! [ "${B_INSERTS:-0}" -gt 0 ] 2>/dev/null; then
  die "备份闸门失败：没有任何 INSERT 行（空备份）。删掉 $BACKUP_FILE 后重做。"
fi
if ! [ "${B_SIZE:-0}" -gt 10240 ] 2>/dev/null; then
  die "备份闸门失败：文件仅 ${B_SIZE:-0} 字节。删掉 $BACKUP_FILE 后重做。"
fi
ok "备份通过闸门：$B_TABLES 张表 / $B_INSERTS 条 INSERT / $B_SIZE 字节。"
note "回滚数据库用的就是这份（skill 第 9 节模板）。"
[ "$DB_WORK" = "1" ] || note "本次为纯代码发布：备份仍然保留，不因跳过数据库阶段而省略。"

# ---------------------------------------------------------------------------
# [P5] 上传产物并暂存校验（服务仍在运行）
# ---------------------------------------------------------------------------
step 5 "上传产物并暂存校验"

ART_BASE="$(basename "$ART")"
say "上传（scp，约 ${ART_SIZE}）…"
scp_retry "$ART" || die "scp 上传失败（重试 3 次仍失败）。检查网络后重跑（会重新上传）。"

REMOTE_SHA="$(remote "sha256sum /tmp/$ART_BASE | awk '{print \$1}'")"
[ "$REMOTE_SHA" = "$ART_SHA256" ] || die "双端 sha256 不一致（本地 $ART_SHA256 vs 远端 $REMOTE_SHA）。重跑重传，别赌。"
ok "双端 sha256 一致（${ART_SHA256:0:12}…）。"

say "服务器端解包与断言…"
remote_script <<REMOTE
set -e
rm -rf /tmp/deploy-stage && mkdir -p /tmp/deploy-stage
tar -xzf /tmp/$ART_BASE -C /tmp/deploy-stage
test "\$(sed -n 's/^commit=//p' /tmp/deploy-stage/BUILD_COMMIT)" = "$TARGET_SHA"
test -s /tmp/deploy-stage/.next/BUILD_ID
test -f /tmp/deploy-stage/public/handbook/index.html
test "\$(cat /tmp/deploy-stage/.next/BUILD_ID)" = "$BUILD_ID"
cp /tmp/deploy-stage/BUILD_COMMIT /tmp/deploy-stage/.next/DEPLOY_COMMIT
echo "暂存就绪：/tmp/deploy-stage（BUILD_ID=$BUILD_ID）"
REMOTE
ok "暂存产物校验通过（commit / BUILD_ID / 文档 三项断言）。（服务全程正常）"

# ---------------------------------------------------------------------------
# [P6] 更新服务器代码与依赖（服务仍在运行，不受影响）
# ---------------------------------------------------------------------------
step 6 "更新服务器代码与依赖（服务仍在运行）"

say "git fetch（单次超时 ${FETCH_TIMEOUT}s，最多 ${FETCH_MAX_ATTEMPTS} 次；失败立即切本地 bundle）…"
FETCH_STARTED=$SECONDS
FETCH_OUT="$(remote_script <<REMOTE
cd $APP_DIR
OK=0
TRIES=0
for i in \$(seq 1 $FETCH_MAX_ATTEMPTS); do
  TRIES=\$i
  if GIT_TERMINAL_PROMPT=0 timeout $FETCH_TIMEOUT git fetch origin main --quiet; then OK=1; break; fi
  echo "fetch 第 \$i 次失败"
  if [ "\$i" -lt "$FETCH_MAX_ATTEMPTS" ]; then sleep 2; fi
done
echo "FETCH_OK=\$OK"
echo "FETCH_TRIES=\$TRIES"
REMOTE
)"
FETCH_WAIT_SECONDS=$((SECONDS - FETCH_STARTED))
printf '%s\n' "$FETCH_OUT" | grep -vE '^FETCH_(OK|TRIES)=' || true
FETCH_OK="$(printf '%s\n' "$FETCH_OUT" | sed -n 's/^FETCH_OK=//p')"
FETCH_TRY_COUNT="$(printf '%s\n' "$FETCH_OUT" | sed -n 's/^FETCH_TRIES=//p')"

if [ "$FETCH_OK" = "1" ]; then
  ok "服务器 fetch 成功（等待 ${FETCH_WAIT_SECONDS}s，尝试 ${FETCH_TRY_COUNT} 次）。"
  remote_script <<REMOTE
set -e
cd $APP_DIR
git merge --ff-only $TARGET_SHA
test "\$(git rev-parse HEAD)" = "$TARGET_SHA"
chown -R $ZAFU_USER:$ZAFU_USER .git
echo "代码已更新：\$(git log --oneline -1 | cat)"
REMOTE
else
  warn "服务器 fetch 失败（等待 ${FETCH_WAIT_SECONDS}s，尝试 ${FETCH_TRY_COUNT} 次）—— 改用本地 bundle 传提交（skill 第 4 节兜底）。"
  BUNDLE_BRANCH="deploy-bundle-$$"
  BUNDLE_FILE="$BUILD_DIR/pc-bundle-$TARGET_SHA.bundle"
  git -C "$REPO_ROOT" branch -f "$BUNDLE_BRANCH" "$TARGET_SHA" >/dev/null
  if ! git -C "$REPO_ROOT" bundle create "$BUNDLE_FILE" "$BUNDLE_BRANCH" --not "$OLD_SHA"; then
    die "本地生成 bundle 失败（缺 $OLD_SHA 对象？）。"
  fi
  scp_retry "$BUNDLE_FILE" || die "bundle 上传失败。"
  BUNDLE_BASE="$(basename "$BUNDLE_FILE")"
  remote_script <<REMOTE
set -e
cd $APP_DIR
git bundle verify /tmp/$BUNDLE_BASE | tail -3
git fetch /tmp/$BUNDLE_BASE refs/heads/$BUNDLE_BRANCH
git merge --ff-only FETCH_HEAD
test "\$(git rev-parse HEAD)" = "$TARGET_SHA"
git update-ref refs/remotes/origin/main $TARGET_SHA
chown -R $ZAFU_USER:$ZAFU_USER .git
rm -f /tmp/$BUNDLE_BASE
echo "代码已更新（bundle 通道）：\$(git log --oneline -1 | cat)"
REMOTE
  rm -f "$BUNDLE_FILE"
fi

say "更新服务器上的文档源码检出（.docs-source；fetch 超时 ${DOCS_FETCH_TIMEOUT}s，最多 ${DOCS_FETCH_MAX_ATTEMPTS} 次，失败只告警）…"
DOCS_FETCH_STARTED=$SECONDS
remote_script <<REMOTE
cd /opt/zafu-pchospital-web/.docs-source 2>/dev/null || { echo "（服务器没有 .docs-source，跳过）"; exit 0; }
OK=0
for i in \$(seq 1 $DOCS_FETCH_MAX_ATTEMPTS); do
  if GIT_TERMINAL_PROMPT=0 timeout $DOCS_FETCH_TIMEOUT git fetch origin main --quiet && git merge --ff-only origin/main >/dev/null 2>&1; then OK=1; break; fi
  if [ "\$i" -lt "$DOCS_FETCH_MAX_ATTEMPTS" ]; then sleep 2; fi
done
if [ "\$OK" = "1" ]; then
  chown -R zafu-web:zafu-web /opt/zafu-pchospital-web/.docs-source
  echo "docs-source 已更新：\$(git log --oneline -1 | cat)"
else
  echo "! 服务器 docs-source 更新失败（7A 部署不受影响：文档产物已打进 .next/public/handbook）"
fi
REMOTE
DOCS_FETCH_WAIT_SECONDS=$((SECONDS - DOCS_FETCH_STARTED))

say "依赖与 Prisma Client（注意：pnpm install 在锁文件没变时会跳过 postinstall，db:generate 必须单独跑）…"
remote_script <<'REMOTE'
set -e
cd /opt/zafu-pchospital-web
pnpm install --frozen-lockfile --reporter=append-only
pnpm db:generate
chown -R zafu-web:zafu-web node_modules src/generated
echo "Prisma Client 模型抽查（前 5 个）："
ls src/generated/prisma/models | head -5
REMOTE
ok "服务器代码 / 依赖 / Prisma Client 就绪。（线上一直跑着旧产物，全程未受影响）"

# ---------------------------------------------------------------------------
# [P7] 数据库变更（需要时）；纯代码发布保持服务运行
# ---------------------------------------------------------------------------
if [ "$DB_WORK" != "1" ]; then
  step 7 "数据库变更阶段（无待执行数据库工作，跳过）"
  if [ "$SCHEMA_CHANGED" = "1" ] && [ -n "$NEW_MIGS" ]; then
    ok "数据库阶段无需执行：schema 变化已由本次新增迁移覆盖（迁移已应用）；跳过 migrate/seed/行数核对。"
  elif [ "$SCHEMA_CHANGED" = "1" ]; then
    ok "数据库阶段无需执行：schema 变化已人工确认无需数据库操作；跳过 migrate/seed/行数核对。"
  else
    ok "纯代码发布：跳过停机阶段的 migrate / seed / 全表行数核对。"
  fi
  note "服务保持运行；P8 才停止服务做产物切换。"
  note "P4 的全量备份仍然保留，不因纯代码发布省略。"
else
  step 7 "【停机】数据库变更（迁移 + seed + 行数核对）"
  say "数据库阶段原因：$DB_REASONS"
  confirm "即将停止线上服务执行数据库变更（通常 10-60 秒）。现在开始？"

  STOP_TS="$(remote 'date +%s')"
  DOCS_SYNC_STOPPED=1
  remote_script <<'REMOTE'
set -e
systemctl stop docs-sync.timer docs-sync.service 2>/dev/null || true
systemctl stop zafu-pchospital-web
echo "服务已停：$(date '+%H:%M:%S')"
REMOTE
  SERVICE_STOPPED=1
  note "docs-sync 定时器与线上服务已停（脚本退出时会把定时器放回去）。"

  say "迁移前快照（停机后、迁移前，全表行数）…"
  remote_script <<'REMOTE'
set -e
set -a; . /opt/zafu-pchospital-db/.env; set +a
count_of() { docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SELECT COUNT(*) FROM \`$1\`"; }
for t in $(docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SHOW TABLES"); do
  printf '%s %s\n' "$t" "$(count_of "$t")"
done > /tmp/deploy-precounts.txt
echo "迁移前行数已记录：/tmp/deploy-precounts.txt（$(wc -l < /tmp/deploy-precounts.txt) 张表）"
REMOTE

  say "pnpm db:migrate:deploy（前向迁移，幂等）…"
  remote_script <<'REMOTE'
set -e
cd /opt/zafu-pchospital-web
pnpm db:migrate:deploy
echo "---- seed（幂等）----"
pnpm db:seed
REMOTE

  say "迁移后核对（行数 diff + 迁移计数）…"
  remote_script <<'REMOTE'
set -e
set -a; . /opt/zafu-pchospital-db/.env; set +a
cd /opt/zafu-pchospital-web
count_of() { docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SELECT COUNT(*) FROM \`$1\`"; }
for t in $(docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SHOW TABLES"); do
  printf '%s %s\n' "$t" "$(count_of "$t")"
done > /tmp/deploy-postcounts.txt

echo "== 行数变化（空 = 完全一致；迁移回填 / seed 造成的合理变化请逐项确认）=="
awk 'NR==FNR{pre[$1]=$2;next}{post[$1]=$2;seen[$1]=1}
END{for(t in seen){p=(t in pre)?pre[t]:"新增"; if(!(t in pre)||p!=post[t]) printf "  %s: %s -> %s\n", t, p, post[t]}}' /tmp/deploy-precounts.txt /tmp/deploy-postcounts.txt | sort

echo "== 迁移计数 =="
APPLIED=$(docker exec zafu-pchospital-db-greatsql-1 mysql -uroot -p"$GREATSQL_ROOT_PASSWORD" -N -B zafu_pchospital -e "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
DIRS=$(ls -d prisma/migrations/*/ | wc -l)
echo "已应用 $APPLIED / 目录 $DIRS"
test "$APPLIED" = "$DIRS"
REMOTE
  ok "迁移与 seed 完成，迁移计数一致。（仍处于停机窗口）"
fi

# ---------------------------------------------------------------------------
# [P8] 原子切换产物并启动服务（纯代码发布在这里停机）
# ---------------------------------------------------------------------------
step 8 "原子切换产物并启动服务"

if [ "$SERVICE_STOPPED" != "1" ]; then
  confirm "即将停止服务并切换产物（秒级停机）。现在开始？"
  STOP_TS="$(remote 'date +%s')"
  DOCS_SYNC_STOPPED=1
  remote_script <<'REMOTE'
set -e
systemctl stop docs-sync.timer docs-sync.service 2>/dev/null || true
systemctl stop zafu-pchospital-web
echo "服务已停：$(date '+%H:%M:%S')"
REMOTE
  SERVICE_STOPPED=1
  note "docs-sync 定时器与线上服务已停（脚本退出时会把定时器放回去）。"
fi

SWAP_OUT="$(remote_script <<REMOTE
set -e
cd $APP_DIR
test "\$(git rev-parse HEAD)" = "$TARGET_SHA"
test -d /tmp/deploy-stage/.next
STAGED_ID=\$(cat /tmp/deploy-stage/.next/BUILD_ID)
CUR_ID=\$(cat .next/BUILD_ID 2>/dev/null || echo none)
if [ "\$CUR_ID" = "\$STAGED_ID" ]; then
  echo "产物已是目标版本（BUILD_ID=\$CUR_ID），跳过切换"
  cp /tmp/deploy-stage/.next/DEPLOY_COMMIT .next/DEPLOY_COMMIT
else
  rm -rf .next.old public/handbook.old
  mv .next .next.old
  if [ -d public/handbook ]; then mv public/handbook public/handbook.old; fi
  mv /tmp/deploy-stage/.next .next
  mv /tmp/deploy-stage/public/handbook public/handbook
  if [ -d .next.old/cache ]; then cp -a .next.old/cache .next/cache; fi
  echo "SWAPPED BUILD_ID=\$(cat .next/BUILD_ID)"
fi
# 部署把 public/handbook 换成了本次构建的版本；docs-sync 的 deployed-sha 已不能代表目录内容，
# 失效后下一次同步会重新核对 gh-pages（也覆盖“产物缓存里的旧文档”）。
if rm -f "$DOCS_SYNC_STATE" 2>/dev/null; then
  echo "DOCS_SYNC_STATE_INVALIDATED=1"
else
  echo "DOCS_SYNC_STATE_INVALIDATION_FAILED=1"
fi
chown -R $ZAFU_USER:$ZAFU_USER .next public/handbook
systemctl start $SERVICE
for i in \$(seq 1 20); do
  sleep 1
  systemctl is-active --quiet $SERVICE && break
done
systemctl is-active $SERVICE
code=""
for i in \$(seq 1 15); do
  code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3311/ || true)
  [ "\$code" = "200" ] && break
  sleep 2
done
echo "INTERNAL_HTTP=\$code"
echo "START_TS=\$(date +%s)"
rm -rf /tmp/deploy-stage /tmp/$ART_BASE
REMOTE
)"
INTERNAL_HTTP="$(printf '%s\n' "$SWAP_OUT" | sed -n 's/^INTERNAL_HTTP=//p')"
START_TS="$(printf '%s\n' "$SWAP_OUT" | sed -n 's/^START_TS=//p')"
DOWNTIME=$((START_TS - STOP_TS))
[ "$INTERNAL_HTTP" = "200" ] || die "切换后内部 curl 未返回 200（得到 ${INTERNAL_HTTP:-无}）。站点可能没起来，看 journalctl -u $SERVICE -n 50。"
SERVICE_STOPPED=0
ok "服务已启动，内部 curl 200；停机时长 ${DOWNTIME}s。上一版产物在 .next.old（--rollback 秒级回退）。"
verify_runtime_commit || true
if printf '%s\n' "$SWAP_OUT" | grep -q '^DOCS_SYNC_STATE_INVALIDATION_FAILED=1'; then
  warn "docs-sync 状态文件未能删除（$DOCS_SYNC_STATE）：请手工检查；revision 标记仍会在下次同步兜底。"
else
  note "docs-sync 状态已失效：下一次定时同步会按 gh-pages 重新核对并发布文档。"
fi

# ---------------------------------------------------------------------------
# [P9] 冒烟验证
# ---------------------------------------------------------------------------
step 9 "冒烟验证（外部地址 $BASE_URL）"
NOTIFY_SMOKE=unknown
SMOKE_FAIL=0
smoke() {
  local p="$1" code
  code="$(curl -sL --max-time 20 -o /dev/null -w '%{http_code}' "$BASE_URL$p" || echo 000)"
  if [ "$code" = "200" ]; then ok "$p -> 200"; else warn "$p -> $code（期望 200）"; SMOKE_FAIL=1; fi
}
for p in / /about /join /docs /repair-activities /robots.txt /sitemap.xml /handbook/; do smoke "$p"; done

if [ -n "$CHUNK_PATH" ]; then
  code="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$BASE_URL$CHUNK_PATH" || echo 000)"
  if [ "$code" = "200" ]; then ok "新构建静态资源已生效：$CHUNK_PATH"; else warn "新构建资源 $CHUNK_PATH -> $code（没打到新产物？）"; SMOKE_FAIL=1; fi
else
  warn "产物里没提取到 chunk 路径，跳过「新构建生效」校验（可核对服务器 .next/BUILD_ID 是否等于 $BUILD_ID）。"
fi

if [ -n "${DEPLOY_SMOKE_QQ:-}" ] && [ -n "${DEPLOY_SMOKE_PASSWORD:-}" ]; then
  say "登录态验证（DEPLOY_SMOKE_QQ 已提供）…"
  CJ="$(mktemp)"
  LOGIN_JSON="$(curl -sS --max-time 20 -c "$CJ" -H "Origin: $BASE_URL" -H "Content-Type: application/json" -d "{\"qq\":\"$DEPLOY_SMOKE_QQ\",\"password\":\"$DEPLOY_SMOKE_PASSWORD\"}" "$BASE_URL/api/v1/auth/login" || true)"
  if printf '%s' "$LOGIN_JSON" | grep -q '"success":true'; then
    ok "登录接口正常"
    code="$(curl -sL --max-time 20 -b "$CJ" -o /dev/null -w '%{http_code}' "$BASE_URL/admin" || echo 000)"
    if [ "$code" = "200" ]; then ok "/admin（登录态）-> 200"; else warn "/admin -> $code"; SMOKE_FAIL=1; fi
  else
    warn "登录失败（响应前 200 字符）：$(printf '%s' "$LOGIN_JSON" | head -c 200)"
    SMOKE_FAIL=1
  fi
  rm -f "$CJ"
else
  note "未设置 DEPLOY_SMOKE_QQ / DEPLOY_SMOKE_PASSWORD，跳过登录态验证（建议人工登录一次管理端确认）。"
fi

if [ "$SMOKE_FAIL" != "0" ]; then
  NOTIFY_SMOKE=failed
  die "冒烟未全过（见上方失败项）。站点已上新版；若确认是新版问题：bash tools/deploy/deploy-prod.sh --rollback"
fi
NOTIFY_SMOKE=passed

# ---------------------------------------------------------------------------
# [P10] 总结与回滚指引
# ---------------------------------------------------------------------------
step 10 "总结与回滚指引"

remote_script <<'REMOTE'
cd /opt/zafu-pchospital-web
echo "服务器 HEAD：$(git log --oneline -1 | cat)"
echo "线上 BUILD_ID：$(cat .next/BUILD_ID)"
echo "服务状态：$(systemctl is-active zafu-pchospital-web) | $(free -m | sed -n '2p')"
REMOTE

if [ "$DOCS_SYNC_STOPPED" = "1" ]; then
  remote_script <<'REMOTE'
systemctl start docs-sync.timer 2>/dev/null || true
echo "docs-sync.timer 已恢复。"
REMOTE
  DOCS_SYNC_STOPPED=0
fi

DEPLOY_OK=1
if verify_runtime_commit && [ "$NOTIFY_COMMIT" = "$TARGET_SHA" ]; then
  NOTIFY_RESULT=success
else
  NOTIFY_COMMIT=""
  NOTIFY_RESULT=unknown
  warn "运行版本未能核实，通知将报告 unknown，不猜测目标 SHA。"
fi
finish_phase
print_phase_timings
say ""
say "${C_GREEN}${C_BOLD}========== 部署完成 ==========${C_OFF}"
say "  提交：      $OLD_SHA -> $TARGET_SHA（共 ${N_COMMITS:-?} 个提交）"
say "  BUILD_ID：  $BUILD_ID"
if [ "$DB_WORK" = "1" ]; then
  say "  数据库阶段：执行（$DB_REASONS）"
else
  say "  数据库阶段：跳过（无待执行数据库工作；P4 备份仍保留）"
fi
say "  停机时长：  ${DOWNTIME}s"
say "  产物：      $ART（sha256 ${ART_SHA256:0:12}…，同提交下次会复用）"
say "  数据库备份：${BACKUP_FILE:-无}"
say "  日志：      $LOG_FILE"
say ""
say "回滚指引："
say "  · 秒级回滚产物（推荐先用它）：bash tools/deploy/deploy-prod.sh --rollback"
say "  · 代码回退：ssh 后 git reset --hard <旧 sha>（破坏性，先确认无未提交改动）"
say "  · 数据库还原：zcat $BACKUP_FILE | docker exec -i zafu-pchospital-db-greatsql-1 mysql -uroot -p\"\$GREATSQL_ROOT_PASSWORD\" zafu_pchospital"
say ""
say "${C_GREEN}${C_BOLD}DEPLOY RESULT: SUCCESS${C_OFF} sha=$TARGET_SHA build_id=$BUILD_ID downtime=${DOWNTIME}s"
