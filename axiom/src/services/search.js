// Real-time web search via Serper API (serper.dev)
// No extra packages — uses built-in https

const https = require('https');

function serperRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return reject(new Error('SERPER_API_KEY missing from .env'));

    const payload = JSON.stringify(body);
    const options = {
      hostname: 'google.serper.dev',
      port: 443,
      path: `/${endpoint}`,
      method: 'POST',
      headers: {
        'X-API-KEY':     apiKey,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse Serper response')); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Run a web search and return a compact text block suitable for Claude to summarize.
 * hint: 'news' | 'weather' | 'general'
 */
async function search(query, hint = 'general') {
  const endpoint = hint === 'news' ? 'news' : 'search';
  const params   = { q: query, num: 5, gl: 'us', hl: 'en' };

  if (hint === 'weather') {
    params.q = `weather ${query}`;
  }

  const raw = await serperRequest(endpoint, params);
  return extractResults(raw, hint);
}

function extractResults(raw, hint) {
  const lines = [];

  // Answer box (instant answer — highest priority)
  if (raw.answerBox) {
    const ab = raw.answerBox;
    if (ab.answer)  lines.push(`ANSWER: ${ab.answer}`);
    if (ab.snippet) lines.push(`SNIPPET: ${ab.snippet}`);
    if (ab.title)   lines.push(`SOURCE: ${ab.title}`);
  }

  // Knowledge graph (entity cards — Wikipedia-style)
  if (raw.knowledgeGraph) {
    const kg = raw.knowledgeGraph;
    if (kg.title)       lines.push(`ENTITY: ${kg.title}${kg.type ? ` (${kg.type})` : ''}`);
    if (kg.description) lines.push(`DESCRIPTION: ${kg.description}`);
    const attrs = Object.entries(kg.attributes || {}).slice(0, 3);
    for (const [k, v] of attrs) lines.push(`${k}: ${v}`);
  }

  // Weather widget
  if (raw.weatherResult) {
    const w = raw.weatherResult;
    lines.push(`WEATHER: ${w.temperature}°${w.unit || 'F'}, ${w.weather}`);
    if (w.humidity)  lines.push(`Humidity: ${w.humidity}`);
    if (w.wind)      lines.push(`Wind: ${w.wind}`);
    if (w.location)  lines.push(`Location: ${w.location}`);
  }

  // News results
  if (hint === 'news' && raw.news) {
    for (const item of raw.news.slice(0, 4)) {
      lines.push(`NEWS: ${item.title} — ${item.snippet || ''} (${item.source || ''}, ${item.date || ''})`);
    }
  }

  // Organic results (fallback / extra context)
  if (raw.organic) {
    const organic = hint === 'news' ? [] : raw.organic.slice(0, 3);
    for (const item of organic) {
      lines.push(`RESULT: ${item.title} — ${item.snippet || ''}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

module.exports = { search };
