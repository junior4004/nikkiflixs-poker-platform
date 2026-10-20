# nikkiflixs-card-prices

Card price lookup backend for the Card Value Scanner app.
Queries eBay SOLD listings for a card and returns real sold prices (title, price, date, URL).

Deployed on Render (free tier) as its own web service, rootDir `card-prices`.

## Endpoints

- `GET /api/health` → 200
- `GET /api/price?player=...&brand=...&year=...&cardNumber=...&set=...&graded=true|false&grader=...&grade=...&condition=...`
  - graded cards: include `grader` + `grade` (e.g. grader=PSA grade=10) so prices match the grade.

## Notes

- CORS open to all origins (public price data only).
- 5-minute in-memory cache per query.
- If eBay bot-blocks this server, set `EBAY_APP_ID` env var to use the official eBay Browse API instead.
