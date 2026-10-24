#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu/Debian server. Run from inside the uploaded project folder:
#   bash deploy/setup.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "==> Adding 1 GB swap if the server has little memory (small free-tier VMs)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 1800 ] && ! swapon --show | grep -q .; then
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installing dependencies"
npm ci --omit=dev

echo "==> Checking PeoplePerHour is reachable from this server"
code=$(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0 Chrome/124' https://www.peopleperhour.com/freelance-jobs || true)
echo "    HTTP $code (expect 200)"
[ "$code" = "200" ] || echo "    WARNING: PeoplePerHour did not return 200 to this server. The bot may be blocked from here."

[ -f config.json ] || { echo "==> config.json missing - copying the example. Edit it before starting!"; cp config.example.json config.json; }
chmod 700 "$DIR"; chmod 600 config.json

echo "==> Installing the background service (starts on boot, restarts on crash)"
sudo tee /etc/systemd/system/pph-alert.service >/dev/null <<UNIT
[Unit]
Description=PeoplePerHour WhatsApp job alerts
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$(command -v node) bot.mjs
Restart=always
RestartSec=10
# exit code 3 = WhatsApp logged this device out: stop instead of looping
RestartPreventExitStatus=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable pph-alert

cat <<MSG

Setup done. Now link WhatsApp once (the QR code shows in this terminal):
    cd $DIR && node bot.mjs
Scan it, wait for "WhatsApp linked as ...", press Ctrl+C, then run:
    sudo systemctl start pph-alert

Useful:
    sudo systemctl status pph-alert      # is it running?
    journalctl -u pph-alert -f           # live logs (Ctrl+C to leave)
    sudo systemctl restart pph-alert     # after editing config.json
MSG
