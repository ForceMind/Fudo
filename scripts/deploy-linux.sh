#!/usr/bin/env bash
set -Eeuo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

APP_DIR="${APP_DIR:-$(pwd)}"
BRANCH="${BRANCH:-}"
PORT="${PORT:-8787}"
SERVICE_NAME="${SERVICE_NAME:-fudo}"
AUTO_GIT_PULL="${AUTO_GIT_PULL:-1}"
INSTALL_SERVICE="${INSTALL_SERVICE:-0}"
NODE_ENV="production"

log() {
  printf '\033[1;36m%s\033[0m\n' "$1"
}

fail() {
  printf '\033[1;31m错误：%s\033[0m\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js 20+。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm，请先安装 npm。"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  fail "当前 Node.js 版本过低：$(node -v)，请使用 Node.js 20+。"
fi

cd "${APP_DIR}"
log "当前目录：$(pwd)"

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
  npm ci
else
  npm install
fi

log "构建生产版本..."
npm run build

mkdir -p data

if [ "${INSTALL_SERVICE}" = "1" ]; then
  command -v systemctl >/dev/null 2>&1 || fail "系统没有 systemctl，无法安装 systemd 服务。"
  NODE_BIN="$(command -v node)"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

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
ExecStart=${NODE_BIN} server/server.mjs
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
  printf 'PORT=%s npm start\n' "${PORT}"
fi

