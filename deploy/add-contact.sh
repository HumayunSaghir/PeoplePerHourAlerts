#!/usr/bin/env bash
# Add (or remove) a number that receives alerts, then restart the bot. Run it on the server:
#   bash deploy/add-contact.sh 447700900123
#   bash deploy/add-contact.sh --remove 447700900123
# The number needs its country code and digits only (no +, spaces or leading 0).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIG:-$DIR/config.json}"

ACTION=add
if [ "${1:-}" = "--remove" ]; then ACTION=remove; shift; fi
NUM="$(printf '%s' "${1:-}" | tr -cd '0-9')"
if ! [[ "$NUM" =~ ^[1-9][0-9]{9,14}$ ]]; then
  echo "Give the number with its country code, digits only. Example: 447700900123" >&2
  exit 1
fi

ACTION="$ACTION" NUM="$NUM" CONFIG="$CONFIG" node -e '
const fs = require("fs");
const { ACTION, NUM, CONFIG } = process.env;
const c = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
c.contacts = c.contacts || [];
if (ACTION === "add") {
  if (c.contacts.includes(NUM)) { console.log("Already on the list."); process.exit(0); }
  c.contacts.push(NUM);
} else {
  c.contacts = c.contacts.filter(n => n !== NUM);
}
fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + "\n");
console.log((ACTION === "add" ? "Added" : "Removed") + " ***" + NUM.slice(-4) + ". Contacts on the list: " + c.contacts.length);
'

# NO_RESTART=1 is only for testing the script itself
if [ -z "${NO_RESTART:-}" ]; then
  sudo systemctl restart pph-alert
  echo "Bot restarted. New contacts get the welcome message within a few seconds."
fi
