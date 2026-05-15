#!/usr/bin/env bash
set -Eeuo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

APP_DIR="${APP_DIR:-$(pwd)}"
BRANCH="${BRANCH:-}"
PORT="${PORT:-8787}"
PORT_SCAN_LIMIT="${PORT_SCAN_LIMIT:-50}"
SERVICE_NAME="${SERVICE_NAME:-fudo}"
AUTO_GIT_PULL="${AUTO_GIT_PULL:-1}"
INSTALL_SERVICE="${INSTALL_SERVICE:-0}"
NODE_ENV="production"
NODE_BIN="${NODE_BIN:-}"
NPM_BIN="${NPM_BIN:-}"
NODE_HOME="${NODE_HOME:-${PRIVATE_NODE_DIR:-}}"

log() {
  printf '\033[1;36m%s\033[0m\n' "$1"
}

fail() {
  printf '\033[1;31m错误：%s\033[0m\n' "$1" >&2
  exit 1
}

to_absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd)" "$1" ;;
  esac
}

resolve_node_bin() {
  if [ -n "${NODE_BIN}" ]; then
    local candidate
    candidate="$(to_absolute_path "${NODE_BIN}")"
    [ -x "${candidate}" ] || fail "NODE_BIN 不可执行：${candidate}"
    printf '%s\n' "${candidate}"
    return
  fi

  local candidates=()
  if [ -n "${NODE_HOME}" ]; then
    candidates+=("${NODE_HOME}/bin/node" "${NODE_HOME}/node")
  fi
  candidates+=(
    "${APP_DIR}/.node/bin/node"
    "${APP_DIR}/.runtime/node/bin/node"
    "${APP_DIR}/runtime/node/bin/node"
    "${APP_DIR}/node/bin/node"
    "${APP_DIR}/nodejs/bin/node"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    candidate="$(to_absolute_path "${candidate}")"
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  command -v node >/dev/null 2>&1 || fail "未找到 Node.js。可安装系统 Node.js 20+，或通过 NODE_HOME / NODE_BIN 指定私有 Node.js。"
  command -v node
}

resolve_npm_bin() {
  if [ -n "${NPM_BIN}" ]; then
    local candidate
    candidate="$(to_absolute_path "${NPM_BIN}")"
    [ -x "${candidate}" ] || fail "NPM_BIN 不可执行：${candidate}"
    printf '%s\n' "${candidate}"
    return
  fi

  local node_dir
  node_dir="$(dirname "${RESOLVED_NODE_BIN}")"
  if [ -x "${node_dir}/npm" ]; then
    printf '%s\n' "${node_dir}/npm"
    return
  fi

  command -v npm >/dev/null 2>&1 || fail "未找到 npm。请确认私有 Node.js 包含 npm，或通过 NPM_BIN 指定 npm 路径。"
  command -v npm
}

validate_port() {
  case "$1" in
    ''|*[!0-9]*) fail "PORT 必须是数字：$1" ;;
  esac
  if [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then
    fail "PORT 必须在 1-65535 之间：$1"
  fi
}

validate_port_scan_limit() {
  case "${PORT_SCAN_LIMIT}" in
    ''|*[!0-9]*) fail "PORT_SCAN_LIMIT 必须是数字：${PORT_SCAN_LIMIT}" ;;
  esac
  if [ "${PORT_SCAN_LIMIT}" -lt 1 ]; then
    fail "PORT_SCAN_LIMIT 必须大于 0：${PORT_SCAN_LIMIT}"
  fi
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :${port}" 2>/dev/null | awk 'NF { found = 1 } END { exit found ? 0 : 1 }'
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v suffix=":${port}" '$4 ~ suffix "$" { found = 1 } END { exit found ? 0 : 1 }'
    return
  fi
  (echo >/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1
}

find_available_port() {
  local start_port="$1"
  local candidate="${start_port}"
  local checked=0

  while [ "${checked}" -le "${PORT_SCAN_LIMIT}" ]; do
    validate_port "${candidate}"
    if ! port_in_use "${candidate}"; then
      printf '%s\n' "${candidate}"
      return
    fi
    log "端口 ${candidate} 已被占用，尝试 $((candidate + 1))。" >&2
    candidate=$((candidate + 1))
    checked=$((checked + 1))
  done

  fail "从端口 ${start_port} 开始连续 ${PORT_SCAN_LIMIT} 个端口都被占用。"
}

cd "${APP_DIR}"
log "当前目录：$(pwd)"

RESOLVED_NODE_BIN="$(resolve_node_bin)"
RESOLVED_NPM_BIN="$(resolve_npm_bin)"
RESOLVED_NODE_DIR="$(dirname "${RESOLVED_NODE_BIN}")"
export PATH="${RESOLVED_NODE_DIR}:${PATH}"
NODE_MAJOR="$("${RESOLVED_NODE_BIN}" -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  fail "当前 Node.js 版本过低：$("${RESOLVED_NODE_BIN}" -v)，请使用 Node.js 20+。"
fi
log "使用 Node.js：${RESOLVED_NODE_BIN} ($("${RESOLVED_NODE_BIN}" -v))"
log "使用 npm：${RESOLVED_NPM_BIN}"

if [ "${AUTO_GIT_PULL}" = "1" ] && [ -d ".git" ]; then
  log "拉取最新代码..."
  git fetch --all --prune
  if [ -n "${BRANCH}" ]; then
    git checkout "${BRANCH}"
    git pull --ff-only origin "${BRANCH}"
  else
    git pull --ff-only
  fi
fi

log "安装依赖..."
if [ -f package-lock.json ]; then
  "${RESOLVED_NPM_BIN}" ci
else
  "${RESOLVED_NPM_BIN}" install
fi

log "构建生产版本..."
"${RESOLVED_NPM_BIN}" run build

mkdir -p data

if [ "${INSTALL_SERVICE}" = "1" ]; then
  command -v systemctl >/dev/null 2>&1 || fail "系统没有 systemctl，无法安装 systemd 服务。"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    log "暂停现有 systemd 服务 ${SERVICE_NAME}，用于检测真实可用端口..."
    sudo systemctl stop "${SERVICE_NAME}"
  fi
fi

validate_port "${PORT}"
validate_port_scan_limit
REQUESTED_PORT="${PORT}"
PORT="$(find_available_port "${PORT}")"
if [ "${PORT}" != "${REQUESTED_PORT}" ]; then
  log "端口 ${REQUESTED_PORT} 不可用，已自动改用 ${PORT}。"
else
  log "使用端口：${PORT}"
fi

if [ "${INSTALL_SERVICE}" = "1" ]; then
  log "写入 systemd 服务：${SERVICE_FILE}"
  sudo tee "${SERVICE_FILE}" >/dev/null <<SERVICE
[Unit]
Description=Fudo Web Game
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
Environment=NODE_ENV=${NODE_ENV}
Environment=PORT=${PORT}
Environment=LANG=${LANG}
Environment=LC_ALL=${LC_ALL}
Environment=PATH=${RESOLVED_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${RESOLVED_NODE_BIN} server/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}"
  sudo systemctl restart "${SERVICE_NAME}"
  log "部署完成：systemd 服务 ${SERVICE_NAME} 已启动，端口 ${PORT}。"
else
  log "部署完成。使用以下命令启动生产服务："
  printf 'NODE_ENV=production PORT=%s "%s" server/server.mjs\n' "${PORT}" "${RESOLVED_NODE_BIN}"
fi
