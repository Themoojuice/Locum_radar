# Importing recruitment information

Imports have three steps: **read → review → commit**. They never send messages or apply for work. Text is parsed on your server; there is no LLM service or external document-processing service in this draft.

## Text and email

Paste the original advertisement, or upload a `.txt`, `.html`, or `.eml` file under 1 MB. HTML is converted to text; it is never rendered as trusted HTML. MIME emails are decoded and their readable bodies processed. Attachments are not extracted. A line containing `---` separates advertisements. If an email lists independently bookable blocks, split them into separate advertisements.

The parser recognises labelled fields and some unambiguous prose: a single known hospital, a title containing a supported specialty/grade, an explicit ISO date range or `11 - 22 January 2027`, and a single currency/rate/unit expression. Unknown or ambiguous fields need review. It never substitutes an advertisement's publication or expiry date for placement dates.

This is a **fictional formatting example**, not a real job:

```text
Title: Psychiatry registrar
Hospital: Cairns Hospital
Town: Cairns
State: QLD
Specialty: Psychiatry
Grade: Registrar
Start: 2027-01-11
End: 2027-01-22
Rate: AUD 160/hour
Paid hours: 80
Super: additional
On-call: none
Flights: included
Accommodation: included
Registration: general
Minimum PGY: 3
Independent cover: no
Supervision available: yes
Requirements complete: no
Roster: Monday-Friday day shifts
Hospital reference: EXAMPLE-HOSPITAL-REQ-123
Listing ID: EXAMPLE-AGENCY-456
URL: https://example.com/fictional-advertisement
Contact: Example recruiter
```

Do not mark requirements complete just because the parser found no more fields. Only use that field when the source has actually confirmed the requirement list.

Other labelled fields include `Credentials` (comma-separated), `Paid days`, `Paid shifts`, `Direct expenses`, `Travel hours`, `Additional pay`, and `Arrangement` (`employee` or `contractor`). Include only facts present in the advertisement or subsequently confirmed. Paid hours mean **total paid hours for the placement**, not hours per day.

Preserve an agency's stable listing ID. The same source and ID update one listing and preserve earlier versions. If no ID exists, the parser uses a content fingerprint; amended text then counts as a new source record until reconciled.

## Recruiter inbox (Gmail)

Open **Recruiter inbox** in the sidebar and press **Import offers** (or let it run by itself: new emails are imported when the app opens, at most every six hours). The app searches Gmail, read-only, for email from the agencies ticked in **Settings**, for example

```
from:(medrecruit.com OR medworld.com OR 1medical.com.au OR wave.com.au OR …) newer_than:30d -in:trash -in:spam -in:sent -in:drafts
```

plus anything under an optional Gmail label. Each email is read once. There is no daily interval or approved-sender list.

### Settings

- **Agencies**: fourteen Australian locum agencies with sign-up links and a "signed up" tick. Untick an agency to stop searching it; add other recruiters' domains below the list. The NSW Health register of locum agencies is linked for finding more.
- **Gmail label** (optional): anything under the label is read too, for unlisted recruiters or adverts you label or forward to yourself. Settings shows the search to turn into a Gmail filter.
- **Claude reader**: an Anthropic API key (console.anthropic.com, prepaid, separate from a Claude subscription; stored encrypted in `data/secrets`). **Check Claude's accuracy** re-reads up to six Medrecruit/1Medical emails with Claude and compares the vacancies with the built-in readers (same dates, grade and pay).
- **Importing**: automatic import on or off, and how many days back to search.

### Readers

- **Built-in readers** handle the layouts Medrecruit and 1Medical send: the weekly digest (`Town ROLE | dates | rate` under state headings), 1Medical's seven-column table, `Position: / Unit: / Dates: / Rate:` blocks, "_Hospital_ in _State_ are seeking…" prose, and single-hospital campaigns with shift lists or rosters (OFF days skipped).
- **Claude Haiku** (`claude-haiku-5-5`) reads emails from other agencies, offer-like emails the built-in readers could not read, and pasted adverts. It is forced to fill a fixed form and copies dates, pay and names exactly as written; the same code as the built-in readers then works out years, date ranges, rates and super, so the notes ("Year inferred from the email date", ranges, ASAP) mean the same thing whichever reader ran. Rows marked ✦ were read by Claude. Typical cost is a fraction of a US cent per email; the running total is shown in Settings. Without a key these emails are kept and read once a key is saved.

### What you see

Each email is classified: **Offers**, **Jobs on linked page** (e.g. Medrecruit's hot-jobs link), **Check email** (offer-like but nothing dated to record, e.g. a permanent post), or **Not a job offer** (newsletters, reminders, admin; collapsed).

Each vacancy shows hospital and state, specialty and grade, dates and length (or its shifts), pay as written plus a comparable figure, super, travel and accommodation, and the email line it came from. Years missing from the email are inferred from its send date and noted. A vacancy naming its hospital, state, grade and dates joins the job feed (source "Recruiter email imports"); the same vacancy in later weekly emails updates one entry. Vacancies missing a detail show **Add hospital** (or similar), which opens the review form prefilled and links the saved job back.

Medrecruit digests name towns rather than hospitals. Towns are matched to the hospital directory when the match is unambiguous, and each match is noted for checking.

### Add an advert

**Add an advert** takes pasted text (a recruiter's SMS, WhatsApp message, Facebook post or forwarded email) and up to four screenshots (drop, paste or choose; resized in the browser before upload). Claude reads them into an inbox record exactly like an email.

**Re-read all** re-reads every email from the period (after an update to the readers). Emails can be hidden from the Emails tab. **Clear old drafts** resolves review items left by the earlier generic Gmail search.

## Reviewing and correcting

The primary fields have ordinary form controls. The expandable full-record editor exposes all remuneration, credential and provenance fields; it is intended for advanced corrections and structured imports. `null` means unknown. Read the original text underneath. Validation errors identify the field to fix.

Committing imports all reviewed records in one database transaction. Invalid batches do not partially commit. Review and source identities are retained. Updated data can be re-imported under the same source/listing ID; the previous source snapshot remains available.

## JSON

Import a single record or array matching `listingInputSchema` in `src/domain/model.ts`. The selected source in the import dialog applies to the whole batch. Import different agencies in separate batches. The schema is the authoritative format; the in-app labelled example can be extracted to see a complete editable record.

## Duplicate resolution

Hospital + overlapping dates alone does not trigger a merge. Automatic linking requires exact facility, specialty, grade, date range, shared hospital reference, roster and compatible requirements. Different recruiter reference numbers are not necessarily shared hospital references. Leave that field blank when uncertain.

Use **Review queue → Inspect opportunity / Inspect possible match**, then confirm a match or keep records separate. On the detail panel, **This is a different vacancy** detaches an offer while retaining its history. Conflicting requirements cannot be merged silently.
