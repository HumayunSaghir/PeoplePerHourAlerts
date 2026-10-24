// Shared PeoplePerHour scraping helpers.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

export const titleFromSlug = url => {
  const slug = url.split('/').pop().replace(/-\d+$/, '').replace(/-/g, ' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

// Slice the balanced {...} object that starts at `start`, respecting JSON strings.
export function sliceObject(s, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === String.fromCharCode(92)) i++; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  throw new Error('unterminated initialState JSON');
}

const symbols = { GBP: '£', EUR: '€', USD: '$' };
const money = (n, cur) => `${symbols[cur] || cur + ' '}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;

// Returns Map<jobId, {id,title,description,budget,url,posted,category,type,proposals}> from one listing page.
export async function fetchJobs(page) {
  const res = await fetch(page, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`${page} -> HTTP ${res.status}`);
  const html = await res.text();
  const jobs = new Map();
  const at = html.indexOf('initialState=');
  if (at >= 0) {
    try {
      const st = JSON.parse(sliceObject(html, html.indexOf('{', at)));
      for (const { attributes: a } of Object.values(st.entities?.projects || {})) {
        if (a.item_type !== 'job' || !a.url) continue;
        const hourly = a.project_type === 'hourly';
        jobs.set(a.proj_id, {
          id: a.proj_id, title: a.title.trim(), description: (a.proj_desc || '').replace(/\s+/g, ' ').trim(),
          budget: a.budget ? `${money(a.budget, a.currency)}${hourly ? '/hr' : ''}` : 'Not specified',
          url: a.url, posted: a.posted_dt,
          category: [a.category?.cate_name, a.sub_category?.subcate_name].filter(Boolean).join(' › '),
          type: hourly ? 'Hourly' : 'Fixed price', proposals: a.proposalCount ?? null,
          client: a.client && {
            name: a.client.public_name || a.client.shortName || '', url: a.client.url || '',
            location: [a.client.city, a.client.country].filter(Boolean).join(', '),
            since: a.client.reg_dt || '', verified: a.client.verified === '1' || a.client.verified === 1,
          },
        });
      }
    } catch (e) { console.error('initialState parse failed, using link fallback:', e.message); }
  }
  if (!jobs.size) { // fallback: links only
    const flat = html.replace(/\u002F/g, '/');
    for (const m of flat.matchAll(/https?:\/\/www\.peopleperhour\.com\/freelance-jobs\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+-(\d{5,})/g))
      jobs.set(Number(m[1]), { id: Number(m[1]), title: titleFromSlug(m[0]), description: '', budget: 'Not specified', url: m[0] });
  }
  return jobs;
}

// Buyer "Insights" from the client's public profile page (no login needed). Cached 10 min; never throws.
const insightsCache = new Map();
export async function fetchClientInsights(url) {
  if (!url || !url.startsWith('https://www.peopleperhour.com/freelancer/')) return null;
  const hit = insightsCache.get(url);
  if (hit && Date.now() - hit.at < 600000) return hit.data;
  let data = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const html = await res.text();
      const field = label => {
        const m = new RegExp(String.raw`insights-label[^>]*>\s*${label}[\s\S]{0,400}?insights-value[^>]*>\s*([^<]+?)\s*<`, 'i').exec(html);
        return m ? m[1].replace(/&amp;/g, '&').trim() : null;
      };
      const d = { projectsListed: field('Projects listed'), freelancersWorkedWith: field('Freelancers worked with'), lastActive: field('Last active'), responseTime: field('Response time') };
      if (Object.values(d).some(v => v != null)) data = d;
    }
  } catch { /* profile unavailable: alert is sent without insights */ }
  insightsCache.set(url, { at: Date.now(), data });
  return data;
}

// Client sidebar + experience level from the job's own public page (what you see on the right when you open a job).
const detailsCache = new Map();
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
export async function fetchJobDetails(url) {
  if (!url || !url.startsWith('https://www.peopleperhour.com/freelance-jobs/')) return null;
  const hit = detailsCache.get(url);
  if (hit && Date.now() - hit.at < 600000) return hit.data;
  let data = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const html = await res.text();
      const stat = label => {
        const m = new RegExp(String.raw`<div class="title">\s*${label}\s*</div>\s*<div class="value">([\s\S]{0,200}?)</div>`, 'i').exec(html);
        if (!m) return undefined;                                  // block not on page
        const v = decode(m[1].replace(/<[^>]+>/g, ''));
        return v && v !== '-' ? v : null;                          // null = shown as "-"
      };
      const rating = /User Rating and Reviews[\s\S]{0,200}?<span class="value">\s*([\d.]+%)\s*<\/span>\s*\((\d+)\)/i.exec(html);
      const exp = /Experience Level:<\/strong>\s*([^<]+)</i.exec(html);
      const d = {
        ratingPct: rating ? rating[1] : null, reviews: rating ? Number(rating[2]) : null,
        completed: stat('Projects Completed'), workedWith: stat('Freelancers worked with'),
        awarded: stat('Projects awarded'), lastProject: stat('Last project'),
        experience: exp ? decode(exp[1]) : null,
      };
      if (rating || Object.values(d).some(v => v !== undefined && v !== null)) data = d;
    }
  } catch { /* page unavailable: alert is sent without these lines */ }
  detailsCache.set(url, { at: Date.now(), data });
  return data;
}
