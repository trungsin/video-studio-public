#!/bin/sh
# Tailscale (userspace networking, no TUN) for the box + expose the app on the tailnet.
# Usage: sh scripts/tailscale-up.sh        (start daemon if needed, login if needed, then serve :3100)
#        sh scripts/tailscale-up.sh status
# After login, tailnet devices open: http://video-studio-box:3100  (MagicDNS)  or http://<100.x ip>:3100
TS=${TS:-$HOME/.local/bin/tailscale}; TSD=${TSD:-$HOME/.local/bin/tailscaled}
DIR=${TS_STATE:-/home/box/.tailscale}; SOCK=$DIR/tailscaled.sock; PORT=${PORT:-3100}
mkdir -p "$DIR"
t() { "$TS" --socket="$SOCK" "$@"; }
if ! t status >/dev/null 2>&1 && ! pgrep -f "tailscaled .*--statedir=$DIR" >/dev/null; then
  nohup "$TSD" --tun=userspace-networking --statedir="$DIR" --socket="$SOCK" >> /tmp/tailscaled.log 2>&1 < /dev/null &
  echo $! > /tmp/tailscaled.pid; sleep 3
fi
[ "$1" = status ] && { t status; t serve status; exit 0; }
if t status 2>&1 | grep -qE "Logged out|NeedsLogin|Log in at"; then
  nohup "$TS" --socket="$SOCK" up --hostname=video-studio-box >> /tmp/tailscale-up.log 2>&1 < /dev/null &
  sleep 6; echo "Log in here:"; grep -o 'https://login.tailscale.com/[^ ]*' /tmp/tailscale-up.log | tail -1
  echo "Then re-run: sh scripts/tailscale-up.sh"; exit 0
fi
# tailnet :PORT (plain HTTP) -> local app
t serve --bg --http "$PORT" "http://127.0.0.1:$PORT"
# HTTPS :443 -> app (cần cho redirect OAuth của Google). Lần đầu cần bật Serve/HTTPS cho tailnet:
# lệnh in ra link login.tailscale.com/f/serve?... cho chủ tailnet bấm; timeout để không treo script.
timeout 20 "$TS" --socket="$SOCK" serve --bg --https=443 "http://127.0.0.1:$PORT" || echo "HTTPS serve chưa bật (xem link ở trên), chạy lại script sau khi bật"
t serve status
echo "App: http://video-studio-box:$PORT  (or http://$(t ip -4 | head -1):$PORT)"
echo "HTTPS (OAuth): https://$(t status --json | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
