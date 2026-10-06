"""Job watch: read users' careers links, keep their openings, match and notify.

The package holds no FastAPI code; ``routes_companies``, ``routes_jobs`` and
``routes_telegram`` are the HTTP surface, and :class:`service.CrawlerService` is
the one object ``create_app`` wires in. Modules:

- ``fetch``      SSRF-safe outbound HTTP (every crawl request goes through it)
- ``text``       posting HTML to plain text
- ``sources``    what a careers link is: a job-board feed or a page
- ``jsonld``     schema.org JobPosting blocks on ordinary pages
- ``ats``        one adapter per job board, each returning ``RawJob`` rows
- ``classify``   categories, experience required and location of a job
- ``match``      a user's preferences against a job
- ``company_list`` CSV / Excel / PDF company lists
- ``telegram``   the bot: link, poll, send digests
- ``service``    the crawl cycle, scheduling, matching and notification
"""
