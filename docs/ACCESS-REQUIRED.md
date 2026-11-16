# Access Required to Switch the Intelligence Layer On

The code is built and tested. What is missing is **permission**, not software.

This document lists exactly what a human must grant, who to ask, and what each
item unlocks. Nothing here needs a developer — it is all account administration.

The service account that already works for Google Sheets is:

```
agentic-ai@plasma-origin-476610-g0.iam.gserviceaccount.com
```

Wherever possible, grant access to **that same service account**. It already
has a working key on the machine, so no new credential needs to be created or
shared over chat.

---

## 1. Google Search Console — unlocks ranking and impression data

**Who to ask:** whoever owns the Search Console property for kenresearch.com
(likely the SEO or web team, not Pranav).

**What to do:**
1. Open Search Console → select the `kenresearch.com` property
2. Settings → Users and permissions → Add user
3. Add `agentic-ai@plasma-origin-476610-g0.iam.gserviceaccount.com`
4. Permission level: **Restricted** (read-only) is sufficient

**Then set:** nothing — the collector finds the property automatically. Set
`GSC_SITE_URL` only if the property is a URL-prefix property with a specific
form such as `https://www.kenresearch.com/`.

**Unlocks:** impressions, clicks, average position and CTR per page and per
query. This feeds the `searchDemand` and `rankingOpportunity` scoring signals.

**Important limitation:** Search Console only covers domains we own. It
**cannot** tell us whether a post on medium.com or hackmd.io is indexed —
that is why indexation detection uses SERP queries instead, and why those
results are treated as evidence rather than proof.

---

## 2. Google Analytics 4 — unlocks traffic and platform attribution

**Who to ask:** whoever administers the GA4 property for kenresearch.com.

**What to do:**
1. GA4 → Admin → Property Access Management
2. Add `agentic-ai@plasma-origin-476610-g0.iam.gserviceaccount.com`
3. Role: **Viewer** is sufficient
4. Also ensure the **Google Analytics Data API** is enabled in the Google Cloud
   project `plasma-origin-476610-g0`

**Then set in `.env`:**
```
GA4_PROPERTY_ID=properties/XXXXXXXXX
```
Find that number in GA4 → Admin → Property Settings → Property ID.

**Unlocks:** sessions, users, engaged sessions and conversions — both per
landing page and **per `utm_source`**.

> **This is the highest-value item on the list.** Every link the system posts
> already carries `utm_source=<platform>&utm_campaign=automation` across 34
> platforms. That tagging has been running for a long time, which means the
> data to answer *"which platforms actually send traffic?"* **already exists in
> GA4 and has simply never been read.** This single grant turns a long-standing
> blind spot into an answer, with no new posting and no waiting period.

---

## 3. Pipedrive — unlocks lead attribution

**Who to ask:** whoever administers Pipedrive.

**What to do:**
1. Pipedrive → Personal preferences → API → copy the personal API token
   (or create a dedicated integration user, which is preferable to a person's
   token so it survives staff changes)
2. Identify which custom fields hold the landing URL and the UTM source

**Then set in `.env`:**
```
PIPEDRIVE_API_TOKEN=...
PIPEDRIVE_FIELD_MAP={"landing_url":"<hash>","utm_source":"<hash>"}
```

To discover the field hash keys:
```
GET https://api.pipedrive.com/v1/dealFields?api_token=YOUR_TOKEN
```
and look for the fields that hold URL / campaign data. If the mapping is left
unset the collector falls back to scanning each deal for anything URL-shaped,
which works but is less reliable.

**Unlocks:** the `historicalLeads` scoring signal — the outcome that actually
matters, and the only one that connects distribution work to revenue.

**Deliberately independent:** this integration shares no code path with GSC or
GA4. It can be switched on first, last, or alone.

---

## 4. Still unanswered — where production runs

Recorded as **UNKNOWN** in `docs/ARCHITECTURE-AUTH-EXECUTION.md`.

This laptop is a development clone: before this work it had no `node_modules`,
no `.env`, no `.accounts/`, no `.sessions/` and no running scheduler.

**Ask Pranav:**
1. Which machine runs the posting daemon?
2. Is it a git checkout that pulls, or a manually copied folder?
3. Is its disk backed up?

Until this is answered, nothing can be deployed and the production database
location cannot be decided.

---

## 5. Two bugs worth telling Pranav about now

Both were found during this work and are fixed in the branch, independent of
any intelligence feature:

1. **`ai-employee/observer.config.example.json` shipped the live spreadsheet
   ID**, and that observer writes to the sheet. Anyone who followed the setup
   instructions pointed it at production. The example now carries a placeholder
   and the code refuses to write with a placeholder or missing ID. **If it is
   already set up on his machine, its config should be checked.**

2. **`.gitignore` contained `scripts/` without a leading slash**, which also
   matched `src/scripts/`. Any new file added there would have been silently
   untracked — appearing to work locally and not existing for anyone else.

---

## What works right now, with no new access

| Capability | Status |
|---|---|
| Google Sheets read/write | Working — service account verified live |
| Tab lock (test isolation) | Working — verified against the live spreadsheet |
| Report → published URL mapping | Working — reads the existing sheet |
| Indexation detection | Working — SERP keys present (12 SerpApi, 4 Zenserp, 4 Serpstack) |
| Content analysis | Working — no external credential needed |
| Opportunity scoring | Working, but scores poorly without GSC/GA4/CRM signals |
| Platform intelligence | **Blocked** — needs GA4 for traffic attribution |
| Lead attribution | **Blocked** — needs Pipedrive |
| Interlinking proposals | Working for HackMD and Mataroa |
| Interlinking application | Working, but requires explicit human approval per link |

---

## Suggested order

1. **GA4** — biggest single unlock, data already exists, answers the platform question
2. **Search Console** — adds ranking signals
3. **Pipedrive** — connects everything to leads
4. **Production machine details** — needed before any deployment

Items 1–3 are independent. None blocks the others.
