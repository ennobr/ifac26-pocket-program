# IFAC 2026 Pocket Program

An unofficial, installable program browser for the IFAC World Congress 2026.

## What it does

- Opens a validated copy of the full program immediately
- Groups papers into sessions and daily time blocks
- Searches session titles, paper titles, authors, affiliations, codes, and rooms
- Saves whole sessions or individual papers to **My program**
- Keeps saved choices on the same device between visits
- Warns about overlapping saved events
- Exports saved choices as an iCalendar (`.ics`) file
- Works offline after the first successful visit

## Local preview

Run a local web server in this folder:

    python3 -m http.server 8000

Then open <http://localhost:8000>.

## Updating the program

The app reads `data/program.json`, which is generated from the five public
PaperCept daily-program pages. To rebuild it:

    python3 scripts/build_program.py

The generator downloads all days in parallel and validates every day before it
replaces the current snapshot. A scheduled GitHub Action checks for updates
every six hours and commits only when the parsed program changes.

## Install on iPhone

The app must be hosted over HTTPS. Open the hosted URL in Safari, tap **Share**,
then **Add to Home Screen**. Visit once while online to cache the latest program.

Saved sessions and papers are stored only in that browser on that device. They
remain available on later visits unless the user clears the site's stored data.

## Data source

The technical program is tentative and may change. Program data comes from the
public IFAC 2026 PaperCept pages through the `r.jina.ai` text gateway during the
automated build. End users download the prepared JSON directly from this app;
their phones do not scrape PaperCept.

This is not an official IFAC or PaperCept product.
