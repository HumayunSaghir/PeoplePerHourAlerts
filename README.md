# PeoplePerHour Job Alerts for WhatsApp

A small Node.js bot that watches [PeoplePerHour](https://www.peopleperhour.com) and sends every new job to WhatsApp
within a couple of minutes, so you can bid while the job is still fresh. No PeoplePerHour account, paid API or
database needed.

Each alert has the budget, when it was posted, the client's rating and history, a short description and the link:

```
🆕 NEW JOB POSTED  ·  PeoplePerHour

📌 Add Phone Number to logo

📋 PROJECT DETAILS
💰 Budget:  £30  ·  Fixed price
🕒 Posted:  23 Oct, 3:57 pm  (4 min ago)
🗂 Category:  Design › Logo Design
👥 Proposals:  3 so far

🧑‍💼 CLIENT DETAILS
👤 Name:  Jane D.   ⭐ 100% positive (33 reviews)
📍 London, United Kingdom
🏆 Projects awarded: 65%  ·  🟢 Last active: Oct 23 2026

🔗 View & apply
https://www.peopleperhour.com/freelance-jobs/…

💬 Reply top5 to see the 5 latest jobs
```

Anyone on the contact list can reply **`top5`** to the bot's number to get the five latest jobs.

## How it works

Every two minutes the bot reads PeoplePerHour's public job pages (the same ones any visitor sees, it never logs in)
and compares them with the jobs it has already seen. For each new one it also reads the job page and the client's
profile for the rating and stats, then sends the message from a WhatsApp account you link once, like WhatsApp Web.

## Setup

You need Node.js 20+, a WhatsApp account to send from (a spare number is a good idea) and the numbers to alert.

```bash
npm install
cp config.example.json config.json    # on Windows: copy config.example.json config.json
node bot.mjs
```

Scan the QR code with the sending phone (**WhatsApp → Linked devices → Link a device**). If that phone is somewhere
else, link by code instead: `node bot.mjs --pair 447700900123` (the sender's number), then on that phone choose
*Link with phone number instead* and type the 8-character code. Have them ready first, because it expires fast.

The login is saved in `auth/`, so later starts skip this. The first run only notes the jobs that are live; alerts
begin with the next new one.

## Configuration

`config.json`, read at startup:

| Setting | Default | Meaning |
| --- | --- | --- |
| `contacts` | `[]` | Numbers that get alerts, with country code, digits only (`"447700900001"`) |
| `includeSelf` | `true` | Also alert the sending number itself |
| `admins` | `[]` | Numbers allowed to manage contacts by message (see below) |
| `countryCode` | none | Lets people type local numbers like `0300…`; Pakistan is `"92"` |
| `maxContacts` | `20` | Cap on the contact list |
| `pollSeconds` | `120` | How often to check |
| `pages` | all jobs | Listing pages to watch, e.g. a single category page |
| `depth` | `3` | Pages scanned per listing |
| `timezone` | `Asia/Karachi` | Time zone for the "Posted" line |

## Managing contacts

An admin messages the bot's number:

| Message | Does |
| --- | --- |
| `add 447700900123` | Adds the number and sends it a welcome message |
| `remove 447700900123` | Removes it |
| `list` | Shows everyone on the list |

Only admins can do this; everyone else is ignored. On a server you can also run
`bash deploy/add-contact.sh 447700900123` (add `--remove` to remove). Only add people who agreed to get the alerts.

## Running it 24/7

The bot has to stay running. [`deploy/DEPLOY.md`](deploy/DEPLOY.md) shows how to put it on a small AWS server, and
`deploy/setup.sh` installs it as a service that starts on boot and restarts after a crash. Never run the same login in
two places, or every alert is sent twice.

## Security

- **`auth/` is your WhatsApp login.** Anyone with it can use that account. Never share or commit it. If a phone is lost,
  remove the device under *Linked devices*.
- `config.json`, `state.json` and `auth/` are git-ignored and hold your numbers and login. Keep them private.
- The bot only talks to peopleperhour.com and WhatsApp. Numbers are masked in logs, and encryption keys are never logged.

## Good to know

- It uses an unofficial WhatsApp library ([Baileys](https://github.com/WhiskeySockets/Baileys)). WhatsApp can restrict
  accounts that send unwanted automated messages, so keep the list small and use a spare number.
- If PeoplePerHour changes its pages, parsing breaks. "No jobs parsed" in the log is the sign.
- Some cloud IPs get blocked by websites or by WhatsApp. `deploy/setup.sh` checks the first.
- Stuck? *Logged out* means delete `auth/` and link again. A rejected pairing code usually means it was typed on a
  different phone than the number you gave, or an older code was used.

## Disclaimer

An independent project, not affiliated with PeoplePerHour or WhatsApp. Use it in line with both services' terms.
