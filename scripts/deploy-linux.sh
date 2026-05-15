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
INSTALL_SERVICE="${INSTALL_SERVICE:-auto}"
NODE_ENV="production"
NODE_BIN="${NODE_BIN:-}"
NPM_BIN="${NPM_BIN:-}"
NODE_HOME="${NODE_HOME:-${PRIVATE_NODE_DIR:-}}"
AUTO_INSTALL_NODE="${AUTO_INSTALL_NODE:-1}"
NODE_MAJOR_REQUIRED="${NODE_MAJOR_REQUIRED:-20}"
NODE_DOWNLOAD_MAJOR="${NODE_DOWNLOAD_MAJOR:-22}"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
PRIVATE_NODE_ROOT="${PRIVATE_NODE_ROOT:-${APP_DIR}/.node}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
ADMIN_HOSTS="${ADMIN_HOSTS:-${ADMIN_HOST:-}}"

log() {
  printf '\033[1;36m%s\033[0m\n' "$1"
}

fail() {
  printf '\033[1;31m错误：%s\033[0m\n' "$1" >&2
  exit 1
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

run_as_root() {
  if is_root; then
    "$@"
    return
  fi
  command -v sudo >/dev/null 2>&1 || fail "需要 root 权限，请使用 sudo bash deploy.sh。"
  sudo "$@"
}

write_root_file() {
  local target="$1"
  if is_root; then
    tee "${target}" >/dev/null
    return
  fi
  command -v sudo >/dev/null 2>&1 || fail "需要 root 权限写入 ${target}，请使用 sudo bash deploy.sh。"
  sudo tee "${target}" >/dev/null
}

resolve_install_service() {
  case "${INSTALL_SERVICE}" in
    0|1) printf '%s\n' "${INSTALL_SERVICE}" ;;
    auto)
      if is_root && command -v systemctl >/dev/null 2>&1; then
        printf '1\n'
      else
        printf '0\n'
      fi
      ;;
    *) fail "INSTALL_SERVICE 只能是 auto、1 或 0：${INSTALL_SERVICE}" ;;
  esac
}

to_absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd)" "$1" ;;
  esac
}

node_major() {
  "$1" -p "process.versions.node.split('.')[0]"
}

resolve_node_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    armv7l) printf 'armv7l\n' ;;
    *) fail "不支持自动安装 Node.js 的 CPU 架构：$(uname -m)。请通过 NODE_HOME 或 NODE_BIN 指定私有 Node.js。" ;;
  esac
}

download_to_file() {
  local url="$1"
  local target="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${target}"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q "${url}" -O "${target}"
    return
  fi
  fail "未找到 curl 或 wget，无法自动下载私有 Node.js。请安装 curl/wget，或通过 NODE_HOME / NODE_BIN 指定私有 Node.js。"
}

install_private_node() {
  [ "${AUTO_INSTALL_NODE}" = "1" ] || fail "未找到可用 Node.js，且 AUTO_INSTALL_NODE=0。请安装 Node.js ${NODE_MAJOR_REQUIRED}+，或通过 NODE_HOME / NODE_BIN 指定私有 Node.js。"
  command -v tar >/dev/null 2>&1 || fail "未找到 tar，无法自动安装私有 Node.js。"

  local target_root
  target_root="$(to_absolute_path "${PRIVATE_NODE_ROOT}")"
  local target_bin="${target_root}/bin/node"
  if [ -x "${target_bin}" ]; then
    printf '%s\n' "${target_bin}"
    return
  fi

  local app_root
  app_root="$(pwd)"
  case "${target_root}" in
    "${app_root}/.node"| "${app_root}/.node/"*) ;;
    *) fail "自动安装 Node.js 只允许写入当前项目的 .node 目录。需要其他位置时请使用 NODE_HOME 或 NODE_BIN。" ;;
  esac

  local arch
  arch="$(resolve_node_arch)"
  local base_url="${NODE_MIRROR%/}/latest-v${NODE_DOWNLOAD_MAJOR}.x"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local sums_file="${tmp_dir}/SHASUMS256.txt"

  log "自动下载私有 Node.js ${NODE_DOWNLOAD_MAJOR}.x (${arch}) 到 ${target_root}..." >&2
  download_to_file "${base_url}/SHASUMS256.txt" "${sums_file}"

  local archive_name
  archive_name="$(awk -v suffix="linux-${arch}.tar.xz" '$2 ~ suffix "$" { print $2; exit }' "${sums_file}")"
  [ -n "${archive_name}" ] || fail "Node.js 下载清单中没有 linux-${arch} 构建。"

  local archive_file="${tmp_dir}/${archive_name}"
  download_to_file "${base_url}/${archive_name}" "${archive_file}"

  if command -v sha256sum >/dev/null 2>&1; then
    local expected_hash
    local actual_hash
    expected_hash="$(awk -v file="${archive_name}" '$2 == file { print $1; exit }' "${sums_file}")"
    actual_hash="$(sha256sum "${archive_file}" | awk '{ print $1 }')"
    [ "${expected_hash}" = "${actual_hash}" ] || fail "Node.js 压缩包校验失败。"
  fi

  local extracted_dir="${tmp_dir}/${archive_name%.tar.xz}"
  tar -xJf "${archive_file}" -C "${tmp_dir}" || fail "Node.js 解压失败，请确认系统 tar 支持 .tar.xz。"
  [ -x "${extracted_dir}/bin/node" ] || fail "Node.js 解压失败，未找到 node 可执行文件。"

  rm -rf "${target_root}"
  mv "${extracted_dir}" "${target_root}"
  rm -rf "${tmp_dir}"
  printf '%s\n' "${target_bin}"
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

  if [ "${AUTO_INSTALL_NODE}" = "1" ]; then
    install_private_node
    return
  fi

  command -v node >/dev/null 2>&1 || fail "未找到 Node.js。可安装系统 Node.js ${NODE_MAJOR_REQUIRED}+，或通过 NODE_HOME / NODE_BIN 指定私有 Node.js。"
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

generate_admin_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  printf '\n'
}

read_existing_admin_token() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  [ -r "${service_file}" ] || return 0
  awk 'index($0, "Environment=ADMIN_TOKEN=") == 1 { sub(/^Environment=ADMIN_TOKEN=/, ""); print; exit }' "${service_file}"
}

cd "${APP_DIR}"
log "当前目录：$(pwd)"
INSTALL_SERVICE="$(resolve_install_service)"
if [ "${INSTALL_SERVICE}" = "1" ]; then
  log "部署模式：自动安装并启动 systemd 服务。"
else
  log "部署模式：仅构建，不安装 systemd 服务。"
fi

RESOLVED_NODE_BIN="$(resolve_node_bin)"
RESOLVED_NODE_DIR="$(dirname "${RESOLVED_NODE_BIN}")"
export PATH="${RESOLVED_NODE_DIR}:${PATH}"
NODE_MAJOR="$(node_major "${RESOLVED_NODE_BIN}")"
if [ "${NODE_MAJOR}" -lt "${NODE_MAJOR_REQUIRED}" ]; then
  if [ -n "${NODE_BIN}" ] || [ "${AUTO_INSTALL_NODE}" != "1" ]; then
    fail "当前 Node.js 版本过低：$("${RESOLVED_NODE_BIN}" -v)，请使用 Node.js ${NODE_MAJOR_REQUIRED}+。"
  fi
  log "当前 Node.js 版本过低：$("${RESOLVED_NODE_BIN}" -v)，改用项目私有 Node.js。"
  RESOLVED_NODE_BIN="$(install_private_node)"
  RESOLVED_NODE_DIR="$(dirname "${RESOLVED_NODE_BIN}")"
  export PATH="${RESOLVED_NODE_DIR}:${PATH}"
  NODE_MAJOR="$(node_major "${RESOLVED_NODE_BIN}")"
  if [ "${NODE_MAJOR}" -lt "${NODE_MAJOR_REQUIRED}" ]; then
    fail "私有 Node.js 版本仍然过低：$("${RESOLVED_NODE_BIN}" -v)，请检查 NODE_DOWNLOAD_MAJOR。"
  fi
fi
RESOLVED_NPM_BIN="$(resolve_npm_bin)"
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
    run_as_root systemctl stop "${SERVICE_NAME}"
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

if [ -z "${ADMIN_TOKEN}" ]; then
  ADMIN_TOKEN="$(read_existing_admin_token)"
fi
if [ -z "${ADMIN_TOKEN}" ]; then
  ADMIN_TOKEN="$(generate_admin_token)"
fi

if [ "${INSTALL_SERVICE}" = "1" ]; then
  log "写入 systemd 服务：${SERVICE_FILE}"
  write_root_file "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Fudo Web Game
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
Environment=NODE_ENV=${NODE_ENV}
Environment=PORT=${PORT}
Environment=ADMIN_TOKEN=${ADMIN_TOKEN}
Environment=ADMIN_HOSTS=${ADMIN_HOSTS}
Environment=LANG=${LANG}
Environment=LC_ALL=${LC_ALL}
Environment=PATH=${RESOLVED_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${RESOLVED_NODE_BIN} server/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

  run_as_root systemctl daemon-reload
  run_as_root systemctl enable "${SERVICE_NAME}"
  run_as_root systemctl restart "${SERVICE_NAME}"
  log "部署完成：systemd 服务 ${SERVICE_NAME} 已启动，端口 ${PORT}。"
else
  log "部署完成。使用以下命令启动生产服务："
  printf 'ADMIN_TOKEN=%q ADMIN_HOSTS=%q NODE_ENV=production PORT=%s "%s" server/server.mjs\n' "${ADMIN_TOKEN}" "${ADMIN_HOSTS}" "${PORT}" "${RESOLVED_NODE_BIN}"
fi

log "后台密钥 ADMIN_TOKEN：${ADMIN_TOKEN}"
log "后台入口路径：/admin?token=${ADMIN_TOKEN}"
if [ -n "${ADMIN_HOSTS}" ]; then
  log "后台允许域名：${ADMIN_HOSTS}"
fi
