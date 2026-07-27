# Atlantica resort event reminders

Push notifications 30 minutes before entertainment and daytime activities at
Atlantica Imperial Resort, for two people.

The resort publishes its schedule only through a lobby kiosk website. This
scrapes it, and delivers reminders two ways:

- **A home-screen web app (PWA)** with Web Push — the primary path.
- **A subscribable calendar feed** (`/feed.ics`) — a backstop, because iOS Web
  Push is good but not bulletproof and there is no second chance at a one-week
  trip. Reminders arrive through the system Calendar app's independent alarm path.

No Apple Developer account, no App Store, no `$99/yr`.

## Setup

```sh
npm install
cp .env.example .env
npm run keys          # VAPID keypair -> .env
```

Generate the three secrets into `.env`:

```sh
# two invite tokens (one per person) and an ICS token
node -e "const c=require('crypto');console.log('INVITE_TOKENS='+[0,0].map(()=>c.randomBytes(24).toString('base64url')).join(','));console.log('ICS_TOKEN='+c.randomBytes(24).toString('base64url'));console.log('COOKIE_SECRET='+c.randomBytes(32).toString('base64url'))"
```

Run it:

```sh
npm run build && npm start
npm test              # 23 unit tests, no network required
npm run scrape        # one-shot: print what the live site currently says
```

## Deploy

Web Push requires HTTPS, so this has to be hosted — `localhost` will not do.

```sh
fly launch --no-deploy          # edit `app` in fly.toml first
fly volumes create atlantica_data --size 1
fly secrets set \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
  INVITE_TOKENS=...,... ICS_TOKEN=... COOKIE_SECRET=...
fly deploy
```

Fly is used because the dispatcher is an in-process cron tick that must run
every minute. Serverless hosts with once-daily cron (Vercel Hobby) cannot drive
a 30-minute-ahead reminder.

## Getting it onto the phones

Send each person **their own** invite link: `https://<host>/s/<their-token>`.

Then, on each iPhone — **this order matters**:

1. Open the invite link **in Safari** (not Chrome — Chrome on iOS cannot install
   a PWA).
2. Tap **Share** → **Add to Home Screen**.
3. Open Atlantica **from the new home-screen icon**.
4. Tap **Enable**, and allow notifications.
5. Tap **Send a test notification** to confirm delivery.

Step 3 is not optional. iOS only permits Web Push from an installed home-screen
app; in a Safari tab the permission prompt simply never succeeds. The app
detects this and shows install instructions instead of a button that could not
work. Requires **iOS 16.4 or later**.

### Calendar backstop

Add `https://<host>/feed.ics?key=<ICS_TOKEN>` on the iPhone via
**Settings → Apps → Calendar → Accounts → Add Account → Other → Add Subscribed
Calendar**. Each event carries a 30-minute alarm. Append
`&only=entertainment` to skip the daytime activities.

## How it works

| | |
|---|---|
| Entertainment | Scraped every 30 min from kiosk category `9252` (rolling ~7 days, with times and venues). |
| Daytime activities | A fixed weekly grid, transcribed into `data/daytime-schedule.json`. |
| Reminders | Dispatcher ticks every minute, fires 30 min before each start, once. |
| Access | One unguessable invite link per person → signed httpOnly cookie. |

### Things that were not obvious

**Event IDs are not unique per occurrence.** The site reuses `id=3243`
("DJ Set", Sky Bar) on three different days. Reminder bookkeeping is therefore
keyed on `category|date|time|id`, not on the event id — keying on the id alone
would send one reminder and silently swallow the other two.

**Day headings are sticky.** The `.day` heading is rendered only on the *first*
card of each day group; later cards that day have an empty day cell. The parser
carries the last-seen day forward, otherwise roughly half the schedule is
misdated.

**Dates have no year.** The site prints `01.08.` and expects you to work it out.
The year is inferred by picking the candidate nearest today, which handles the
December→January rollover. When the label also names a weekday
("Wednesday, 29.07."), that name is used as a free correctness check and a
mismatch throws rather than quietly reminding you on the wrong day.

**The daytime PDF is not parsed at runtime.** Its text layer extracts as
character-split, locale-tagged fragments with no reliable column→weekday
mapping. It is a static timetable, so it is transcribed once by rendering the
PDF to an image and reading the grid. The scraper watches the PDF's URL and
content hash and pushes a notification when the resort publishes a new one —
that is the signal to re-transcribe `data/daytime-schedule.json`:

```sh
curl -s "$(node -e '...pdf url...')" -o day.pdf && pdftoppm -png -r 150 day.pdf grid
```

**A failed scrape never empties the schedule.** Occurrences are upserted and
never deleted by a run that returns fewer results, and a parse yielding zero
events raises an error rather than reporting "nothing on tonight".

**Cold starts don't spam.** On first boot anything already inside its reminder
window is marked as sent, so deploying at 20:50 does not immediately fire every
21:00 show.

## Timezone

All date maths runs explicitly in `Europe/Athens` (EEST, UTC+3 in summer), never
the host's zone — the server runs in UTC and the site publishes bare wall-clock
times with no offset. Greece and Cyprus share identical EET/EEST rules, so the
same constant is correct for either Atlantica property.
