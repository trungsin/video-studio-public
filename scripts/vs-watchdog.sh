#!/bin/sh
# Giữ sống web (next-server) và worker đăng tự động. Khởi chạy bởi `sh scripts/serve.sh start`.
# Không khởi lại web khi có cờ /tmp/video-studio.stopped (serve.sh stop). Log: /tmp/video-studio-watchdog.log
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD; STOPF=${STOPF:-/tmp/video-studio.stopped}; WLOG=${WLOG:-/tmp/video-studio-autopublish.log}
echo $$ > /tmp/video-studio-watchdog.pid
ts() { TZ=Asia/Ho_Chi_Minh date '+%F %T'; }
while :; do
  if [ ! -f "$STOPF" ] && ! pgrep -f "^next-server" >/dev/null; then
    echo "$(ts) web không chạy -> khởi động lại"; sh "$ROOT/scripts/serve.sh" start-app
  fi
  if [ ! -f /tmp/video-studio-autopublish.off ] && ! pgrep -f "worker/autopublish.ts --watch" >/dev/null; then
    echo "$(ts) worker autopublish không chạy -> khởi động"
    (cd "$ROOT" && DATA_DIR="$ROOT/data" MEDIA_DIR="$ROOT/media" nohup node node_modules/.bin/tsx worker/autopublish.ts --watch >> "$WLOG" 2>&1 < /dev/null &)
  fi
  sleep 60
done
