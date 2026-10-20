const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

app.get('/api/health', (req, res) => res.status(200).send('ok'));

// Build an eBay search query from card fields. Graded cards MUST include
// grader + grade (e.g. "PSA 10") because a PSA 10 and PSA 9 are different prices.
function buildQuery(p) {
  const parts = [];
  if (p.year) parts.push(String(p.year).trim());
  if (p.brand) parts.push(String(p.brand).trim());
  if (p.set) parts.push(String(p.set).trim());
  if (p.player) parts.push(String(p.player).trim());
  if (p.cardNumber) parts.push('#' + String(p.cardNumber).trim().replace(/^#/, ''));
  const graded = String(p.graded || '').toLowerCase() === 'true';
  if (graded) {
    if (p.grader) parts.push(String(p.grader).trim().toUpperCase());
    if (p.grade) parts.push(String(p.grade).trim());
  } else if (p.condition && !/near mint/i.test(p.condition)) {
    parts.push(String(p.condition).trim());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(s) {
  if (!s) return null;
  const first = String(s).split(/\s+to\s+/i)[0];
  const m = first.replace(/,/g, '').match(/([\d]+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

async function fetchSold(query) {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) +
    '&LH_Sold=1&LH_Complete=1&_ipg=60&_sop=13';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });
    const html = await r.text();
    return { status: r.status, html };
  } finally {
    clearTimeout(timer);
  }
}

function parseSold(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('li.s-item').each((i, el) => {
    const $el = $(el);
    const title = $el.find('.s-item__title').first().text().trim();
    if (!title || /^shop on ebay/i.test(title)) return;
    const price = parsePrice($el.find('.s-item__price').first().text().trim());
    if (price == null) return;
    const href = $el.find('a.s-item__link').first().attr('href');
    const url = href ? href.split('?')[0] : null;
    let soldDate = null;
    const sig = $el.find('.s-item__caption--signal, .s-item__subtitle').text().trim();
    const dm = sig.match(/(?:sold|ended)[^\w]*([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2,4})/i);
    if (dm) soldDate = dm[1];
    items.push({ title, price, soldDate, url });
  });
  return items;
}

// Fallback: official eBay Browse (Finding) API when EBAY_APP_ID is set.
async function browseApi(query) {
  const appId = process.env.EBAY_APP_ID;
  const url = 'https://svcs.ebay.com/services/search/FindingService/v1' +
    '?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0' +
    '&SECURITY-APPNAME=' + encodeURIComponent(appId) +
    '&RESPONSE-DATA-FORMAT=JSON' +
    '&keywords=' + encodeURIComponent(query) +
    '&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true' +
    '&itemFilter(1).name=ListingType&itemFilter(1).value=FixedPrice' +
    '&itemFilter(1).value=Auction' +
    '&paginationInput.entriesPerPage=40&sortOrder=EndTimeSoonest';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  const resp = (j.findCompletedItemsResponse || [])[0] || {};
  const ack = (resp.ack || [])[0];
  if (ack !== 'Success') throw new Error('ebay api ack: ' + ack);
  const raw = (((resp.searchResult || [])[0] || {}).item) || [];
  return raw.map(it => ({
    title: (it.title || [])[0] || '',
    price: parseFloat((((it.sellingStatus || [])[0] || {}).currentPrice || [])[0]?.__value__ || 'NaN') || null,
    soldDate: (((it.listingInfo || [])[0] || {}).endTime || [])[0] || null,
    url: (it.viewItemURL || [])[0] || null,
  })).filter(x => x.title && x.price != null);
}

app.get('/api/price', async (req, res) => {
  const query = buildQuery(req.query);
  if (!query) return res.status(400).json({ error: 'empty_query', hint: 'pass player, brand, year, cardNumber, etc.' });
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return res.json(hit.data);

  const done = (data) => { cache.set(key, { t: Date.now(), data }); res.json(data); };

  if (process.env.EBAY_APP_ID) {
    try {
      const results = await browseApi(query);
      return done({ query, source: 'ebay_browse_api', count: results.length, results });
    } catch (e) { /* fall through to scrape */ }
  }

  try {
    const { status, html } = await fetchSold(query);
    if (status === 403 || status === 429 || /captcha|robot check|pardon our interruption|access denied/i.test(html)) {
      return res.status(502).json({
        error: 'ebay_blocked', query, status,
        hint: 'eBay bot protection blocked this server IP. Set EBAY_APP_ID env to use the official Browse API instead.',
      });
    }
    if (status !== 200) return res.status(502).json({ error: 'ebay_fetch_failed', query, status });
    const results = parseSold(html);
    return done({ query, source: 'ebay_sold_search', count: results.length, results: results.slice(0, 40) });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_error', query, detail: String(e && e.message || e).slice(0, 200) });
  }
});

app.get('/', (req, res) => res.status(200).send('nikkiflixs-card-prices ok'));

app.listen(PORT, () => console.log('card-prices listening on ' + PORT));
