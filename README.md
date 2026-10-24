# PeoplePerHour Job Alerts for WhatsApp

A small Node.js bot that watches [PeoplePerHour](https://www.peopleperhour.com) for new jobs and sends each one to
WhatsApp as soon as it appears, with the budget, the client's track record and a link to apply.

It was built so a freelancer (and a few friends) can be among the first to bid, without keeping a browser tab open
all day. It needs no PeoplePerHour account, no paid API and no database.

## What an alert looks like

```
🆕 NEW JOB POSTED  ·  PeoplePerHour

📌 Add Phone Number to logo

📋 PROJECT DETAILS
💰 Budget:  £30  ·  Fixed price
🕒 Posted:  23 Oct, 3:57 pm GMT+5  (4 min ago)
🗂 Category:  Design › Logo Design
🎓 Experience level:  Entry
👥 Proposals:  3 so far

🧑‍💼 CLIENT DETAILS
👤 Name:  Jane D.
⭐ Rating:  100% positive  (33 reviews)
📍 Location:  London, United Kingdom
✔️ Projects completed:  13
🤝 Freelancers worked with:  12
🏆 Projects awarded:  65%
📆 Last project:  14 Oct 2026
📊 Projects posted:  20
🟢 Last active:  Oct 23 2026
⚡ Response time:  instantly

📝 DESCRIPTION
> I have a logo that I would like a phone number added to…

🔗 View & apply
https://www.peopleperhour.com/freelance-jobs/…

💬 Reply top5 to see the 5 latest jobs
```

Anyone on the contact list can reply **`top5`** (or `5`) to the bot's number at any time and get the five most recent
jobs in the same format.

## How it works

1. Every two minutes the bot downloads the first three pages of PeoplePerHour's public job list.
2. It remembers every job ID it has already seen (`state.json`). Anything it hasn't seen before is a new job.
   It tracks IDs rather than "the highest ID so far" because a job that goes live late can have an older ID.
3. For each new job it also reads the job's own page and the client's public profile, which is where the rating
   and the client statistics live.
4. It sends the message from a WhatsApp account that you link once, the same way you would link WhatsApp Web.

PeoplePerHour doesn't offer a public API, so this reads the same public pages any visitor can open. It never logs in.

## Requirements

- Node.js 20 or newer
- A WhatsApp account to send from (a spare number is a good idea, see [Limitations](#limitations))
- The phone numbers that should receive alerts

## Quick start

```bash
git clone <this repository>
cd <folder>
npm install
cp config.example.json config.json     # on Windows: copy config.example.json config.json
```

Edit `config.json` (see below), then start the bot:

```bash
node bot.mjs
```

The first time, a QR code appears in the terminal. On the sending phone open
**WhatsApp → Settings → Linked devices → Link a device** and scan it. The QR code expires after about 20 seconds
and refreshes itself.

If the person who owns the sending phone is somewhere else, link by code instead of QR. Use their number with the
country code and no `+`, spaces or leading zero:

```bash
node bot.mjs --pair 447700900123
```

The bot prints an 8-character code. On that phone choose **Link a device → Link with phone number instead** and type
it in. Have them on that screen before you run the command, because the code only lasts a minute or two.

Once linked, the login is saved in the `auth/` folder, so later starts skip this step. The first run only records
the jobs that are live at that moment; alerts begin with the next new job.

## Configuration

`config.json` is read when the bot starts, so restart it after changing anything.

| Setting | Default | What it does |
| --- | --- | --- |
| `contacts` | `[]` | Numbers that receive alerts. Country code first, digits only, e.g. `"447700900001"`. |
| `includeSelf` | `true` | Also send alerts to the linked number itself. Turn this off if the sender should stay quiet. |
| `pollSeconds` | `120` | How often to check for new jobs. |
| `pages` | all jobs | Which listing pages to watch. Use a category page to narrow it down, e.g. `https://www.peopleperhour.com/freelance-jobs/technology-programming`. |
| `depth` | `3` | How many pages of each listing to scan. |
| `timezone` | `Asia/Karachi` | Time zone used when showing when a job was posted. Any [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) works. |

Each contact gets a one-time "alerts activated" message the first time a given sending number is linked.

### Adding or removing a contact

On a server, use the helper script. It edits `config.json` and restarts the bot for you:

```bash
cd ~/pph
bash deploy/add-contact.sh 447700900123            # add
bash deploy/add-contact.sh --remove 447700900123   # remove
```

On your own computer, add the number to `contacts` in `config.json` by hand, then stop the bot and start it again.
Either way, the number must be on WhatsApp, and it's polite to tell the person first.

## Running it all the time

The bot has to stay running to send alerts. On your own computer that means keeping the terminal open. To keep it
running 24/7 for free (or very cheaply), put it on a small cloud server. [`deploy/DEPLOY.md`](deploy/DEPLOY.md) walks
through doing that on AWS EC2, and `deploy/setup.sh` installs everything and sets the bot up as a service that starts
on boot and restarts after a crash.

Never run the same linked account in two places at once. Every alert would be sent twice.

## Security and privacy

- **The `auth/` folder is your WhatsApp login.** Anyone who has it can use that WhatsApp account. It is excluded
  from git on purpose. Never upload, share or commit it.
- `config.json` holds phone numbers and `state.json` holds job IDs and hashed send records. Both are git-ignored.
- The bot only talks to peopleperhour.com and to WhatsApp. There's no telemetry.
- Only numbers on your contact list can trigger a `top5` reply. Messages from anyone else are ignored.
- Phone numbers are masked in the logs (`***1234`), and the WhatsApp library's session dumps are silenced so that no
  encryption keys end up in log files.
- If a phone is lost or you suspect a leak, remove the device under **WhatsApp → Linked devices**. That ends the
  session immediately.

## Limitations

- **This uses an unofficial WhatsApp library** ([Baileys](https://github.com/WhiskeySockets/Baileys)). WhatsApp does
  not endorse it, and accounts that send lots of unwanted automated messages can be restricted or banned. Keep the
  contact list small, only message people who agreed to it, and prefer a spare number over your main one.
- **PeoplePerHour can change its pages at any time**, which would break the parsing. If alerts stop and the log says
  "No jobs parsed", that's the likely reason.
- PeoplePerHour's timestamps carry no time zone. They turned out to be UTC, and the bot converts them.
- Cloud providers' IP addresses are sometimes blocked by websites, and WhatsApp can occasionally log out a session
  that moves to a data-centre IP. Both are checked or explained in the deployment guide.
- The client's rating and statistics are only what PeoplePerHour shows publicly. New clients simply show `—`.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `Logged out. Delete the auth folder…` | The device was unlinked in WhatsApp. Delete the `auth` folder and link again. |
| Pairing code rejected | The code must be typed on the phone whose number you passed to `--pair`, and only the newest code works. Keep the terminal open while entering it. |
| No alerts, no errors | There may simply be no new jobs. Send `top5` to the bot's number to check that sending works. |
| `top5` gets no reply | The sender must be in `contacts`, and the bot must be running. The terminal prints a line for every `top5` it sees. |
| Alerts arrive twice | The same login is running in two places. Stop one of them. |
| A new contact didn't get the welcome message | Restart the bot after editing `config.json`. |

## Project layout

```
bot.mjs             the bot: WhatsApp connection, polling, message formatting, top5 replies
pph.mjs             reads PeoplePerHour pages (job list, job details, client profile)
config.example.json copy to config.json and edit
deploy/             server setup script, add-contact helper and a deployment guide
```

`config.json`, `state.json` and `auth/` are created on your machine and are never committed.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by or connected to PeoplePerHour or WhatsApp.
Use it responsibly and in line with both services' terms.
