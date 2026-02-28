const ALLOWED_ORIGINS = [
  'https://calculabs.github.io',
  'https://form.jotform.com',
  'https://www.jotform.com',
  'https://submit.jotform.com',
  'https://eu.jotform.com',
];

const DEMO_SALE_FILTER_ID = 10143;
const SALES_REP_FIELD_ID = 69;
const SALES_REP_FIELD_KEY = 'facd9fa577e3e35573573d03b248eb2ce2987eb7';
const ADDRESS_FIELD_KEY = 'c2f35ff46a62827ff9fd000e9fc7480a1fee3a43';

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function pipedrive(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const resp = await fetch(`https://api.pipedrive.com/v1${path}${sep}api_token=${token}`);
  if (!resp.ok) throw new Error(`Pipedrive API error: ${resp.status}`);
  return resp.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    try {
      // --- GET /deals — all Demo-Sale deals with resolved fields ---
      if (url.pathname === '/deals') {
        // Fetch Sales Rep field options to resolve enum IDs → labels
        const repField = await pipedrive(`/dealFields/${SALES_REP_FIELD_ID}`, env.PIPEDRIVE_API_TOKEN);
        const repOptions = {};
        for (const opt of (repField.data?.options || [])) {
          repOptions[String(opt.id)] = opt.label;
        }

        // Fetch filtered deals
        const json = await pipedrive(`/deals?filter_id=${DEMO_SALE_FILTER_ID}&limit=500`, env.PIPEDRIVE_API_TOKEN);
        const deals = (json.data || []).map(d => {
          const person = d.person_id || {};
          const phones = person.phone || [];
          const repId = d[SALES_REP_FIELD_KEY];
          return {
            id: d.id,
            title: d.title,
            address: d[ADDRESS_FIELD_KEY] || '',
            phone: phones.length > 0 ? phones[0].value : '',
            salesRep: repId ? (repOptions[String(repId)] || '') : '',
          };
        });

        return jsonResponse(deals, 200, origin);
      }

      // --- GET /deals/:id/activity — latest activity for a deal ---
      const activityMatch = url.pathname.match(/^\/deals\/(\d+)\/activity$/);
      if (activityMatch) {
        const dealId = activityMatch[1];
        const json = await pipedrive(`/deals/${dealId}/activities`, env.PIPEDRIVE_API_TOKEN);
        const activities = json.data || [];

        // Prefer most recent undone activity, fallback to most recent done
        const undone = activities.filter(a => !a.done).sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
        const done = activities.filter(a => a.done).sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
        const activity = undone[0] || done[0] || null;

        if (!activity) {
          return jsonResponse({ due_date: '', due_time: '' }, 200, origin);
        }

        return jsonResponse({
          due_date: activity.due_date || '',
          due_time: activity.due_time || '',
        }, 200, origin);
      }

      // --- GET /deal-fields/:key — field options lookup (existing) ---
      const fieldMatch = url.pathname.match(/^\/deal-fields\/([a-fA-F0-9]+)$/);
      if (!fieldMatch) {
        return jsonResponse({ error: 'Not found' }, 404, origin);
      }

      const fieldKey = fieldMatch[1];
      const isNumeric = /^\d+$/.test(fieldKey);

      let field;
      if (isNumeric) {
        const json = await pipedrive(`/dealFields/${fieldKey}`, env.PIPEDRIVE_API_TOKEN);
        field = json.data;
      } else {
        const json = await pipedrive('/dealFields', env.PIPEDRIVE_API_TOKEN);
        field = (json.data || []).find(f => f.key === fieldKey);
        if (!field) {
          return jsonResponse({ error: 'Field not found for key: ' + fieldKey }, 404, origin);
        }
      }

      return jsonResponse({
        id: field.id,
        name: field.name,
        field_type: field.field_type,
        options: field.options || [],
      }, 200, origin);

    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal error' }, 500, origin);
    }
  },
};
