#!/bin/bash
# Chay 2 bot Discord cung luc trong 1 server Bot-Hosting.net
# Bot 1 (ThanThu) la tien trinh CHINH -> quyet dinh vong doi container.
# Bot 2 (Tieu Ngong) la tien trinh phu -> loi cung khong lam sap Bot 1.

cd /home/container || exit 1

BOT2_DIR="Bot 2 - Tiểu Ngỗng"
BOT2_PID=""

# --- Bot 2 (phu) ---
if [ -f "$BOT2_DIR/index.js" ]; then
  echo "[start.sh] Khoi dong Bot 2 (Tieu Ngong)..."
  ( cd "$BOT2_DIR" && node index.js ) &
  BOT2_PID=$!
  echo "[start.sh] Bot 2 PID=$BOT2_PID"
else
  echo "[start.sh] Bo qua Bot 2: khong tim thay '$BOT2_DIR/index.js'"
fi

# --- Bot 1 (chinh, chay foreground) ---
echo "[start.sh] Khoi dong Bot 1 (ThanThu)..."
node index.js
STATUS=$?

# Bot 1 dung -> don dep Bot 2 roi thoat de host restart
echo "[start.sh] Bot 1 da dung (exit=$STATUS), don dep Bot 2..."
[ -n "$BOT2_PID" ] && kill "$BOT2_PID" 2>/dev/null
exit $STATUS
