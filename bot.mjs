// Link your own WhatsApp via QR (like WhatsApp Web) and send PeoplePerHour job alerts
// from it to yourself + the contacts in config.json. Keep this process running.
//   node bot.mjs          run the alert bot (first run shows a QR code to scan)
// Anyone on the list can send "top5" to the linked number to get the 5 latest jobs.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, normalizeMessageContent } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchJobs, fetchClientInsights, fetchJobDetails } from './pph.mjs';

// The WhatsApp library prints whole session records (encryption keys) via console.info/warn. Never log them.
console.info = () => {};
const _warn = console.warn;
console.warn = (...args) => { if (!args.some(x => x && typeof x === 'object')) _warn(...args); };

const dir = new URL('.', import.meta.url);
const CONFIG = new URL('./config.json', dir), STATE = new URL('./state.json', dir);
if (!existsSync(CONFIG)) { console.error('Create config.json first (copy config.example.json).'); process.exit(1); }
const cfg = { pages: ['https://www.peopleperhour.com/freelance-jobs'], pollSeconds: 120, includeSelf: true, contacts: [], ...JSON.parse(readFileSync(CONFIG, 'utf8')) };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const digits = s => String(s || '').replace(/\D/g, '').replace(/:\d+$/, '');
// Never store or print raw phone numbers: state.json keeps only a hash, logs show the last 4 digits.
const hash = jid => createHash('sha256').update(jid).digest('hex').slice(0, 16);
const mask = jid => '***' + String(jid).split('@')[0].split(':')[0].slice(-4);
const readState = () => ({ lastId: 0, intro: {}, ...(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}) });
const scrub = st => ({ ...st, intro: Object.fromEntries(Object.entries(st.intro || {}).filter(([k]) => !k.includes('@'))) });
const writeState = s => writeFileSync(STATE, JSON.stringify(scrub(s)) + '\n');
let timer;
// Optional: `node bot.mjs --pair 447700900123` links by 8-character code instead of QR.
const pairIdx = process.argv.indexOf('--pair');
const PAIR_NUMBER = pairIdx > 0 ? String(process.argv[pairIdx + 1] || '').replace(/\D/g, '') : '';
let pairRequested = false;

const selfNumber = sock => sock.user.id.split(':')[0].split('@')[0];
const selfJid = sock => selfNumber(sock) + '@s.whatsapp.net';
// De-duplicated, so a number that is both the linked account and a contact gets each alert once.
const targets = sock => [...new Set([...(cfg.includeSelf ? [selfJid(sock)] : []), ...cfg.contacts.map(n => digits(n) + '@s.whatsapp.net')])];
const footer = `\n\n💬 _Reply_ *top5* _to see the 5 latest jobs_`;
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
// PeoplePerHour timestamps have no timezone; they are UTC (verified against live jobs). Show them in the user's timezone + "x ago".
const SRC_TZ = cfg.sourceTimezone || 'UTC', OUT_TZ = cfg.timezone || 'Asia/Karachi';
const tzOffsetMs = (utcMs, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(utcMs).map(x => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
};
const parsePosted = s => {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s || '');
  if (!m) return null;
  const guess = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, SRC_TZ), SRC_TZ);
};
const ago = ms => {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m ago`;
  return `${Math.floor(min / 1440)}d ago`;
};
const postedLine = s => {
  const ms = parsePosted(s);
  if (ms == null) return null;
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: OUT_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(ms);
  return `🕒 *Posted:*  ${when}  (${ago(ms)})`;
};
// One job as a structured card. `title` is the heading line (already formatted).
const memberSince = d => { const m = /^(d{4})-(dd)/.exec(d || ''); return m ? new Date(Date.UTC(m[1], m[2] - 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null; };
const plural = (n, w) => `${n} ${w}${String(n) === '1' ? '' : 's'}`;
const dash = v => (v == null || v === '' ? '—' : v);
const clientLines = (c, d) => c && c.name ? [
  `👤 *Name:*  ${c.name}${c.verified ? '  ✅ verified' : ''}`,
  d && d.ratingPct != null && `⭐ *Rating:*  ${d.reviews ? `${d.ratingPct} positive  (${plural(d.reviews, 'review')})` : 'No reviews yet'}`,
  c.location && `📍 *Location:*  ${c.location}`,
  memberSince(c.since) && `📅 *Member since:*  ${memberSince(c.since)}`,
  d && d.completed !== undefined && `✔️ *Projects completed:*  ${dash(d.completed)}`,
  d && d.workedWith !== undefined && `🤝 *Freelancers worked with:*  ${dash(d.workedWith ?? c.insights?.freelancersWorkedWith)}`,
  d && d.awarded !== undefined && `🏆 *Projects awarded:*  ${dash(d.awarded)}`,
  d && d.lastProject !== undefined && `📆 *Last project:*  ${dash(d.lastProject)}`,
  c.insights?.projectsListed != null && `📊 *Projects posted:*  ${c.insights.projectsListed}`,
  c.insights?.lastActive && `🟢 *Last active:*  ${c.insights.lastActive}`,
  c.insights?.responseTime && `⚡ *Response time:*  ${c.insights.responseTime}`,
] : [];
// Fetch the client's public profile + the job page sidebar (both in parallel); either may be missing.
const withInsights = async j => {
  const [insights, details] = await Promise.all([fetchClientInsights(j.client?.url), fetchJobDetails(j.url)]);
  if (j.client) j.client.insights = insights;
  j.details = details;
  return j;
};
// Card = title, then three labelled sections: project details, client details, description; then the link.
const jobCard = (j, title, descLen) => {
  const project = [
    `💰 *Budget:*  ${j.budget}${j.type ? `  ·  ${j.type}` : ''}`,
    postedLine(j.posted),
    j.category && `🗂 *Category:*  ${j.category}`,
    j.details?.experience && `🎓 *Experience level:*  ${j.details.experience}`,
    j.proposals != null && `👥 *Proposals:*  ${j.proposals} so far`,
  ].filter(Boolean);
  const client = clientLines(j.client, j.details).filter(Boolean);
  return [
    title,
    `📋 *PROJECT DETAILS*\n${project.join('\n')}`,
    client.length && `🧑‍💼 *CLIENT DETAILS*\n${client.join('\n')}`,
    j.description && `📝 *DESCRIPTION*\n> ${clip(j.description, descLen)}`,
    `🔗 *View & apply*\n${j.url}`,
  ].filter(Boolean).join('\n\n');
};

// Job IDs are assigned at creation, not when a job goes live, so a late-approved job can have an
// older ID and sit on page 2+. Scan the first `depth` pages and track every ID seen.
async function loadJobs() {
  const all = new Map();
  for (const base of cfg.pages) {
    for (let page = 1; page <= (cfg.depth || 3); page++) {
      const u = new URL(base); if (page > 1) u.searchParams.set('page', page);
      try { for (const [id, j] of await fetchJobs(u.href)) all.set(id, j); }
      catch (e) { if (page === 1) throw e; console.error(`page ${page} skipped: ${e.message}`); }
      await sleep(500);
    }
  }
  if (!all.size) throw new Error('No jobs parsed (layout changed or blocked)');
  return all;
}

async function broadcast(sock, text) {
  for (const jid of targets(sock)) {
    try { await sock.sendMessage(jid, { text }); await sleep(1500); }
    catch (e) { console.error(`send to ${mask(jid)} failed: ${e.message}`); }
  }
}

async function check(sock) {
  const state = readState();
  const all = await loadJobs();
  const seen = new Set(state.seen || []);
  // First run (or upgrade from the old lastId state): record what is live now, alert only on jobs after this.
  const fresh = seen.size ? [...all.values()].filter(j => !seen.has(j.id)).sort((a, b) => (a.posted || '').localeCompare(b.posted || '') || a.id - b.id).slice(-10) : [];
  for (const j of fresh) await withInsights(j);
  for (const j of fresh) await broadcast(sock, `🆕 *NEW JOB POSTED*  ·  _PeoplePerHour_\n\n` + jobCard(j, `📌 *${j.title}*`, 200) + footer);
  console.log(`${new Date().toISOString()} ${fresh.length} new job(s)`);
  for (const id of all.keys()) seen.add(id);
  writeState({ ...readState(), seen: [...seen].sort((a, b) => a - b).slice(-3000) });
}

async function top5Text() {
  const jobs = [...(await loadJobs()).values()].sort((a, b) => (b.posted || '').localeCompare(a.posted || '') || b.id - a.id).slice(0, 5);
  await Promise.all(jobs.map(withInsights));
  const cards = jobs.map((j, i) => jobCard(j, `${NUM[i]} *${j.title}*`, 160));
  return [`📋 *TOP 5 LATEST JOBS*  ·  _PeoplePerHour_`, '', cards.join(`\n\n\n`), footer].join('\n');
}

// Tell each recipient (once) that they'll get alerts.
async function sendIntros(sock) {
  const state = readState();
  for (const jid of targets(sock)) {
    if (state.intro[hash(selfNumber(sock) + ">" + jid)]) continue;
    try {
      await sock.sendMessage(jid, { text: `✅ *JOB ALERTS ACTIVATED*  ·  _PeoplePerHour_

You will now receive every new job posted on PeoplePerHour, straight to this WhatsApp.

*Each alert includes:*
📌  Job title
💰  Budget & price type
🕒  Time posted
🗂  Category
👥  Proposals so far
🔗  Direct link to apply

*How to use:*
💬  Reply *top5* at any time to get the 5 latest jobs.

_Alerts are sent from +${selfNumber(sock)}_` });
      state.intro[hash(selfNumber(sock) + ">" + jid)] = true; writeState({ ...readState(), intro: state.intro }); await sleep(1500);
    } catch (e) { console.error(`intro to ${mask(jid)} failed: ${e.message}`); }
  }
}

const idNum = j => String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
function isAllowed(sock, key) {
  const peers = [key.remoteJid, key.remoteJidAlt, key.participantAlt, key.participant].filter(Boolean).map(idNum);
  const mine = [selfNumber(sock), idNum(sock.user.lid)].filter(Boolean);
  if (key.fromMe) return peers.some(p => mine.includes(p));              // you typed it in your own chat
  const allowed = targets(sock).map(idNum);
  return peers.some(p => allowed.includes(p));                           // a listed contact messaged us
}

// ---- Contact management by WhatsApp message (admins only) -------------------------------------------------------
// An admin sends "add 447700900123", "remove 447700900123" or "list" to the bot's number. Everyone else is ignored.
const MAX_CONTACTS = Number(cfg.maxContacts) || 20;
const adminNumbers = () => (cfg.admins || []).map(n => normalizeNumber(n)).filter(Boolean);
// Digits only, with country code. A leading 0 is read as a local number when `countryCode` is set (e.g. "92").
function normalizeNumber(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0') && cfg.countryCode) n = String(cfg.countryCode).replace(/\D/g, '') + n.slice(1);
  return /^[1-9]\d{9,14}$/.test(n) ? n : null;
}
const pretty = n => '+' + n;
function saveContacts() {
  const raw = JSON.parse(readFileSync(CONFIG, 'utf8'));
  raw.contacts = cfg.contacts;
  writeFileSync(CONFIG, JSON.stringify(raw, null, 2) + '\n');
}
const HELP = `👥 *CONTACT MANAGER*\n\n` +
  `➕ *add* 447700900123\n➖ *remove* 447700900123\n📋 *list*\n\n` +
  `_Use the country code. A number starting with 0 is read as a local number${cfg.countryCode ? ` (+${cfg.countryCode})` : ''}._`;
const adminLog = [];                                                         // timestamps, to rate-limit commands

// Returns true if the message was an admin command (handled or refused), false if it is something else.
async function handleAdminCommand(sock, m, text) {
  const cmd = /^(add|remove|delete|list|help)\b\s*(.*)$/is.exec(text);
  if (!cmd) return false;
  const admins = adminNumbers();
  if (!admins.length || m.key.fromMe) return false;
  const senders = [m.key.remoteJid, m.key.remoteJidAlt, m.key.participantAlt, m.key.participant].filter(Boolean).map(idNum);
  if (!senders.some(s => admins.includes(s))) {
    console.log(`contact command from ${mask(m.key.remoteJid)}: ignored (not an admin or number unverified)`);
    return false;
  }
  const now = Date.now();
  while (adminLog.length && now - adminLog[0] > 60000) adminLog.shift();
  const reply = t => sock.sendMessage(m.key.remoteJid, { text: t });
  if (adminLog.length >= 10) { await reply('⏳ Too many commands. Please wait a minute.'); return true; }
  adminLog.push(now);

  const action = cmd[1].toLowerCase(), arg = cmd[2].trim();
  try {
    if (action === 'help') { await reply(HELP); return true; }
    if (action === 'list') {
      await reply(`📋 *ALERT CONTACTS* (${cfg.contacts.length}/${MAX_CONTACTS})\n\n` + (cfg.contacts.map((n, i) => `${i + 1}. ${pretty(n)}`).join('\n') || '_none yet_'));
      return true;
    }
    const num = normalizeNumber(arg);
    if (!num) { await reply(`⚠️ That doesn't look like a valid number.\n\n${HELP}`); return true; }
    if (action === 'add') {
      if (num === selfNumber(sock)) { await reply('⚠️ That is the sending number itself.'); return true; }
      if (cfg.contacts.includes(num)) { await reply(`ℹ️ ${pretty(num)} is already on the list.`); return true; }
      if (cfg.contacts.length >= MAX_CONTACTS) { await reply(`⚠️ The list is full (${MAX_CONTACTS}). Remove someone first.`); return true; }
      cfg.contacts.push(num); saveContacts();
      console.log(`contact added by admin: ${mask(num)} (${cfg.contacts.length} total)`);
      await reply(`✅ Added ${pretty(num)}.\nContacts: ${cfg.contacts.length}/${MAX_CONTACTS}. They will receive the welcome message now.`);
      await sendIntros(sock);
    } else {
      if (!cfg.contacts.includes(num)) { await reply(`ℹ️ ${pretty(num)} is not on the list.`); return true; }
      cfg.contacts = cfg.contacts.filter(n => n !== num); saveContacts();
      console.log(`contact removed by admin: ${mask(num)} (${cfg.contacts.length} total)`);
      await reply(`✅ Removed ${pretty(num)}.\nContacts: ${cfg.contacts.length}/${MAX_CONTACTS}.`);
    }
  } catch (e) { console.error('contact command failed:', e.message); await reply('⚠️ Something went wrong. Nothing was changed.').catch(() => {}); }
  return true;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(new URL('./auth', dir).pathname.replace(/^\/(\w:)/, '$1'));
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), browser: PAIR_NUMBER ? Browsers.ubuntu('Chrome') : Browsers.macOS('Desktop'), syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      const age = Date.now() / 1000 - Number(m.messageTimestamp || 0);
      if (age > 120) continue;                                         // ignore history replayed on connect
      const c = normalizeMessageContent(m.message) || {};
      const text = (c.conversation || c.extendedTextMessage?.text || '').trim();
      if (await handleAdminCommand(sock, m, text)) continue;
      if (!/^(top\s?5|5)$/i.test(text)) continue;
      const ok = isAllowed(sock, m.key);
      console.log(`top5 request from ${mask(m.key.remoteJid)}${m.key.fromMe ? ' (you)' : ''}: ${ok ? 'replying' : 'ignored (not on your list)'}`);
      if (!ok) continue;
      try { await sock.sendMessage(m.key.remoteJid, { text: await top5Text() }); }
      catch (e) { console.error('top5 failed:', e.message); }
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && PAIR_NUMBER && !sock.authState.creds.registered) {
      // Link by code instead of QR: the phone owner types this code, so nobody has to scan a screen remotely.
      if (!pairRequested) {
        pairRequested = true;
        try { console.log(`\nPairing code for +${PAIR_NUMBER}:  ${await sock.requestPairingCode(PAIR_NUMBER)}\nOn that phone: WhatsApp > Settings > Linked devices > Link a device > "Link with phone number instead", then type the code.\n`); }
        catch (e) { pairRequested = false; console.error('Could not get a pairing code:', e.message); }
      }
    } else if (qr) { console.log('\nScan with WhatsApp > Settings > Linked devices > Link a device:\n'); qrcode.generate(qr, { small: true }); }
    if (connection === 'open') {
      console.log('WhatsApp linked as', mask(sock.user.id));
      await sendIntros(sock);
      const tick = () => check(sock).catch(e => console.error('check failed:', e.message));
      tick(); clearInterval(timer); timer = setInterval(tick, cfg.pollSeconds * 1000);
    }
    if (connection === 'close') {
      clearInterval(timer);
      const code = lastDisconnect?.error?.output?.statusCode;
      const why = lastDisconnect?.error?.message;
      console.log(`Connection closed (code ${code ?? 'none'}${why ? `: ${why}` : ''}).`);
      if (code === DisconnectReason.loggedOut) { console.error('Logged out. Delete the auth folder and run again to re-link.'); process.exit(3); }
      if (PAIR_NUMBER && !sock.authState.creds.registered) pairRequested = false;   // any earlier code is now invalid: issue a new one
      console.log('Reconnecting...'); setTimeout(start, 3000);
    }
  });
}
start();
