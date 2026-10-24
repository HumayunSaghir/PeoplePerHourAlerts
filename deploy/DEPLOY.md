# Free 24/7 deployment on AWS (EC2)

The bot must run all the time and keep its WhatsApp login on disk, so serverless/sleeping free tiers
(Lambda, Render, GitHub Actions, Vercel) do not work. A small EC2 virtual machine does.

**Free-tier reality:** AWS free usage is time-limited (6 months on the new Free Plan, 12 months on older accounts),
then a t3.micro costs roughly US$8-10/month. Set the budget alert in step 1 so you are never surprised,
and stop/terminate the instance before the free period ends if you don't want to pay.

## 1. Create the server (once, ~10 min)
1. AWS Console -> **Billing -> Budgets -> Create budget** (zero-spend or $1 budget with email alert).
2. Pick a region (top-right), e.g. Mumbai `ap-south-1` or Frankfurt `eu-central-1`.
3. **EC2 -> Launch instance**
   - Name: `pph-alert`; Image: **Ubuntu Server 24.04 LTS**
   - Instance type: **t3.micro** (or **t4g.small** if it shows "Free tier eligible" on your account)
   - Key pair: *Create new key pair* (RSA, `.pem`) and save it somewhere safe.
   - Network: allow **SSH (port 22) from "My IP"** only. The bot needs no inbound ports.
   - Storage: 8-10 GB gp3. Launch.
4. When it is running, copy the **Public IPv4 address**.

## 2. Upload the project (PowerShell, in the project folder on your PC)
```powershell
cd C:\Users\Max\Desktop\PeoplePerHourAlert
tar -czf $env:TEMP\pph.tgz --exclude=auth --exclude=node_modules --exclude=state.json .
scp -i C:\path\to\pph.pem $env:TEMP\pph.tgz ubuntu@YOUR_PUBLIC_IP:~
ssh -i C:\path\to\pph.pem ubuntu@YOUR_PUBLIC_IP
```
If Windows complains the key file is "too open", right-click the .pem -> Properties -> Security -> keep only your user.
(`auth` is left out on purpose: the server links its own WhatsApp session.)

## 3. On the server
```bash
mkdir pph && tar -xzf pph.tgz -C pph && rm pph.tgz && cd pph
bash deploy/setup.sh          # Node, dependencies, swap, background service
node bot.mjs                  # QR code appears: scan it, wait for "WhatsApp linked", press Ctrl+C
sudo systemctl start pph-alert
```
Never run the bot on your PC and the server at the same time: every alert would be sent twice.
Close the bot on your PC first (Ctrl+C), and you can remove its old linked device in WhatsApp.

## 4. Check it
`journalctl -u pph-alert -f` shows a line every 2 minutes. Send `top5` to the linked number to test.
It restarts itself after crashes and reboots. After editing `config.json`: `sudo systemctl restart pph-alert`.

## Risks to know
- **PeoplePerHour may block datacenter IPs.** `setup.sh` tests this and warns if it does not get HTTP 200.
- **WhatsApp may log out a session linked from a datacenter IP.** If the log says "Logged out", the service stops;
  re-link with `rm -rf auth && node bot.mjs`, then `sudo systemctl start pph-alert`.
- Keep the .pem key private; the server's `auth/` folder is your WhatsApp login. Don't open any extra ports.
- Other free options: Oracle Cloud Always Free VM (permanent but harder to get), or an old Android phone with Termux.

## Linking a friend's WhatsApp from another city (no QR needed)
On the server, instead of `node bot.mjs`, run (friend's number, country code, digits only):
```bash
node bot.mjs --pair 447700900123
```
It prints an 8-character code. Your friend opens WhatsApp > Settings > Linked devices > Link a device >
"Link with phone number instead" and types the code. Then Ctrl+C and `sudo systemctl start pph-alert`.
