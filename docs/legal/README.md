# Legal

`terms.md` and `privacy.md` are published via GitHub Pages so both app stores have stable
URLs, and so the Login and About screens have something real to link to.

> ⚠️ **These are drafts written from what the app actually does — not reviewed legal advice.**
> Get a lawyer's pass before store submission, particularly on India's Digital Personal Data
> Protection Act 2023 (grievance officer designation, consent notice wording, and data
> principal rights all have specific statutory requirements this draft only approximates).

## Before publishing

Replace every `[BRACKETED]` placeholder:

- `[ENTITY]` — the legal entity or individual publishing the app
- `[JURISDICTION]` — governing law and courts
- `[CONTACT_EMAIL]` — a real, monitored address; both stores require one
- `[GRIEVANCE_OFFICER]` — required under the DPDP Act if operating in India
- `[EFFECTIVE_DATE]`

## Publishing

Enable GitHub Pages on the repo (`Settings → Pages`, source `main`, folder `/legal`). The
resulting URLs go into App Store Connect, Play Console, and `app.config.ts`.

The same domain is also needed for iOS Universal Links and Android App Links so invite links
resolve when the app isn't installed — see open question #3 in `plan/PROGRESS.md`.
