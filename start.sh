#!/usr/bin/env bash
set -Eeuo pipefail

# Chạy 3 bot Discord cùng lúc trên 1 server Bot-Hosting.net.
# Panel chỉ cần đặt START BASH FILE=start.sh, không cần thao tác console.

cd /home/container || exit 1

BOT2_DIR="Bot 2 - Tiểu Ngỗng"
BOT3_DIR="Bot 3 - Chiến Ngỗng"
BOT1_PID=""
BOT2_PID=""
BOT3_PID=""

log() {
  printf '[start.sh] %s\n' "$*"
}

prefix_output() {
  local label="$1"
  local line=""

  while IFS= read -r line || [ -n "$line" ]; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

run_bot() {
  local label="$1"
  local dir="$2"

  if [ "$dir" != "." ]; then
    cd "$dir"
  fi

  exec node index.js \
    > >(prefix_output "$label") \
    2> >(prefix_output "$label")
}

has_env() {
  local dir="$1"
  local name="$2"

  if [ ! -f "$dir/.env" ]; then
    log "Thiếu .env của $name tại $dir/.env"
    return 1
  fi

  return 0
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  log "Đang dọn tiến trình bot phụ..."
  for pid in "$BOT3_PID" "$BOT2_PID" "$BOT1_PID"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  [ -n "${BOT3_PID:-}" ] && wait "$BOT3_PID" 2>/dev/null || true
  [ -n "${BOT2_PID:-}" ] && wait "$BOT2_PID" 2>/dev/null || true
  [ -n "${BOT1_PID:-}" ] && wait "$BOT1_PID" 2>/dev/null || true

  exit "$status"
}

trap cleanup EXIT INT TERM

start_bot2() {
  if [ ! -f "$BOT2_DIR/index.js" ]; then
    log "Bỏ qua Bot 2: không tìm thấy $BOT2_DIR/index.js"
    return 0
  fi

  if ! has_env "$BOT2_DIR" "Bot 2"; then
    log "Bỏ qua Bot 2 để tránh lỗi token/config."
    return 0
  fi

  log "Khởi động Bot 2 (Tiểu Ngỗng)..."
  run_bot "Tiểu Ngỗng" "$BOT2_DIR" &
  BOT2_PID=$!
  log "Bot 2 PID=$BOT2_PID"
}

start_bot3() {
  if [ ! -f "$BOT3_DIR/index.js" ]; then
    log "Bỏ qua Bot 3: không tìm thấy $BOT3_DIR/index.js"
    return 0
  fi

  if ! has_env "$BOT3_DIR" "Bot 3"; then
    log "Bỏ qua Bot 3 để tránh lỗi token/config."
    return 0
  fi

  log "Khởi động Bot 3 (Chiến Ngỗng)..."
  run_bot "Chiến Ngỗng" "$BOT3_DIR" &
  BOT3_PID=$!
  log "Bot 3 PID=$BOT3_PID"
}

log "Thư mục chạy: $(pwd)"
log "Node: $(node -v 2>/dev/null || printf 'không tìm thấy')"

# Bot Discord không dùng các folder web/tài nguyên (WebBangChien/WebTimer phục vụ Vercel,
# anh = ảnh gốc, rac = lưu trữ). Sau mỗi lần host git pull, xóa chúng khỏi bản chạy
# để tiết kiệm dung lượng. Repo trên GitHub và Vercel vẫn giữ nguyên các folder này.
for web_dir in "WebBangChien" "WebTimer" "anh" "rac"; do
  if [ -d "$web_dir" ]; then
    log "Dọn folder không cần cho bot: $web_dir"
    rm -rf "$web_dir" || true
  fi
done

if ! has_env "." "Bot 1"; then
  log "Dừng khởi động vì Bot 1 thiếu .env."
  exit 1
fi

log "Khởi động Bot 1 (Đại Ngỗng / bot chính)..."
run_bot "Đại Ngỗng" "." &
BOT1_PID=$!
log "Bot 1 PID=$BOT1_PID"

# Cho Bot 1 mở voice relay link server trước, rồi bot phụ mới kết nối vào.
sleep 3
start_bot2
start_bot3

STATUS=0
wait "$BOT1_PID" || STATUS=$?
log "Bot 1 đã dừng với exit=$STATUS"
exit "$STATUS"
