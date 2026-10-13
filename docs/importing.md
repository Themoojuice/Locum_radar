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

Other labelled fields include `Credentials` (comma-separated), `Paid days`, `Paid shifts`, `Direct expenses`, `Travel hours`, `Additional pay`, `Arrangement` (`employee` or `contractor`) and `Flexibility` (`flexible` or `fixed`). Phrases such as "flexible dates" or "dates negotiable" in the text also mark a vacancy flexible. JSON imports may also carry `shifts` (a list of `{ date, start, end, kind }`); listed shifts replace the continuous block when checking your calendar and estimating paid days. Include only facts present in the advertisement or subsequently confirmed. Paid hours mean **total paid hours for the placement**, not hours per day.

Preserve an agency's stable listing ID. The same source and ID update one listing and preserve earlier versions. If no ID exists, the parser uses a content fingerprint; amended text then counts as a new source record until reconciled.

## Reviewing and correcting

The primary fields have ordinary form controls. The expandable full-record editor exposes all remuneration, credential and provenance fields; it is intended for advanced corrections and structured imports. `null` means unknown. Read the original text underneath. Validation errors identify the field to fix.

Committing imports all reviewed records in one database transaction. Invalid batches do not partially commit. Review and source identities are retained. Updated data can be re-imported under the same source/listing ID; the previous source snapshot remains available.

## JSON

Import a single record or array matching `listingInputSchema` in `src/domain/model.ts`. The selected source in the import dialog applies to the whole batch. Import different agencies in separate batches. The schema is the authoritative format; the in-app labelled example can be extracted to see a complete editable record.

## Duplicate resolution

Hospital + overlapping dates alone does not trigger a merge. A different source advertising the same hospital, specialty and grade with start and end dates each within three days is queued as a **likely duplicate** for review; confirming it keeps every offer with its own dates and widens the vacancy to span them. Splitting the listing back out restores its own dates. Automatic linking requires exact facility, specialty, grade, date range, shared hospital reference, roster and compatible requirements. Different recruiter reference numbers are not necessarily shared hospital references. Leave that field blank when uncertain.

Use **Review queue → Inspect opportunity / Inspect possible match**, then confirm a match or keep records separate. On the detail panel, **This is a different vacancy** detaches an offer while retaining its history. Conflicting requirements cannot be merged silently.
