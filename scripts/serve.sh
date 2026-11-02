#!/bin/sh
# Start the production server in the background (box/VM, no Docker) + watchdog giữ sống web và worker đăng tự động.
# Usage: sh scripts/serve.sh [start|stop|restart|status|stop-all|restart-worker]
#   start          web + watchdog (watchdog khởi động lại web nếu chết và giữ worker/autopublish.ts --watch chạy)
#   stop           dừng web (worker đăng tự động VẪN chạy; dùng stop-all để dừng hẳn)
#   stop-all       dừng web, watchdog và worker
#   restart-worker khởi động lại worker (sau khi đổi code/.env/data/autopublish.json)
# Logs: /tmp/video-studio.log, /tmp/video-studio-autopublish.log, /tmp/video-studio-watchdog.log
# Sau khi máy (box) khởi động lại: chạy lại `sh scripts/serve.sh start`.
cd "$(dirname "$0")/.." || exit 1
LOG=${LOG:-/tmp/video-studio.log}; PIDF=${PIDF:-/tmp/video-studio.pid}; PORT=${PORT:-3100}; STOPF=/tmp/video-studio.stopped
wd_running() { pgrep -f "scripts/vs-watchdog.sh" >/dev/null; }
start_wd() { wd_running || { nohup sh "$PWD/scripts/vs-watchdog.sh" >> /tmp/video-studio-watchdog.log 2>&1 < /dev/null & echo "watchdog started"; }; }
stop_web() { [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; pkill -f "next start -p $PORT" 2>/dev/null; pkill -f "^next-server" 2>/dev/null; rm -f "$PIDF"; sleep 1; }
stop_worker() { pkill -f "worker/autopublish.ts --watch" 2>/dev/null; sleep 1; }
start_app() {
  pgrep -f "^next-server" >/dev/null && { echo "already running (pid $(pgrep -f "^next-server" | head -1))"; return 0; }
  grep -q '^ADMIN_PASSWORD=.\+' .env 2>/dev/null || { echo "ADMIN_PASSWORD not set in .env - refusing to start"; return 1; }
  [ -x .venv/bin/python ] && export PYTHON_BIN="$PWD/.venv/bin/python"
  export NODE_ENV=production DATA_DIR="$PWD/data" MEDIA_DIR="$PWD/media"
  nohup node node_modules/.bin/next start -p "$PORT" >> "$LOG" 2>&1 < /dev/null &
  sleep 4; p=$(pgrep -f "^next-server" | head -1); echo "${p:-$!}" > "$PIDF"
  echo "started pid $(cat "$PIDF"), log $LOG, http://localhost:$PORT"
}
case "${1:-start}" in
  stop) touch "$STOPF"; stop_web; echo "stopped (web). Worker đăng tự động vẫn chạy: dùng stop-all để dừng hẳn" ;;
  stop-all) touch "$STOPF" /tmp/video-studio-autopublish.off; pkill -f "scripts/vs-watchdog.sh" 2>/dev/null; stop_worker; stop_web; echo "stopped all" ;;
  restart) touch "$STOPF"; stop_web; rm -f "$STOPF"; start_app; start_wd ;;
  restart-worker) stop_worker; rm -f /tmp/video-studio-autopublish.off; start_wd; echo "worker sẽ được watchdog khởi động lại trong ≤60s" ;;
  status)
    p=$(pgrep -f "^next-server" | head -1); [ -n "$p" ] && echo "web: running pid $p, port $PORT" || echo "web: not running"
    w=$(pgrep -f "worker/autopublish.ts --watch" | head -1); [ -n "$w" ] && echo "autopublish worker: running pid $w" || echo "autopublish worker: not running"
    d=$(pgrep -f "scripts/vs-watchdog.sh" | head -1); [ -n "$d" ] && echo "watchdog: running pid $d" || echo "watchdog: not running" ;;
  start-app) start_app ;;
  start) rm -f "$STOPF" /tmp/video-studio-autopublish.off; start_app; start_wd ;;
  *) echo "usage: $0 [start|stop|restart|status|stop-all|restart-worker]"; exit 1 ;;
esac
