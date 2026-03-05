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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

    // Require API key on all requests
    const authHeader = request.headers.get('Authorization') || '';
    const apiKey = authHeader.replace(/^Bearer\s+/i, '');
    if (!env.WORKER_API_KEY || apiKey !== env.WORKER_API_KEY) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
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
          const rawPhone = phones.length > 0 ? phones[0].value : '';
          // Strip non-digits, then remove leading 1 for US country code
          let digits = rawPhone.replace(/\D/g, '');
          if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
          const repId = d[SALES_REP_FIELD_KEY];

          // Split person name into first/last
          const personName = (typeof person === 'object' ? person.name : '') || '';
          const nameParts = personName.trim().split(/\s+/);
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          // Structured address sub-fields
          const streetNum = d[ADDRESS_FIELD_KEY + '_street_number'] || '';
          const route = d[ADDRESS_FIELD_KEY + '_route'] || '';
          const streetAddress = [streetNum, route].filter(Boolean).join(' ');

          return {
            id: d.id,
            title: d.title,
            address: d[ADDRESS_FIELD_KEY] || '',
            streetAddress,
            city: d[ADDRESS_FIELD_KEY + '_locality'] || '',
            state: d[ADDRESS_FIELD_KEY + '_admin_area_level_1'] || '',
            zip: d[ADDRESS_FIELD_KEY + '_postal_code'] || '',
            phone: rawPhone,
            phoneArea: digits.length >= 10 ? digits.slice(0, 3) : '',
            phoneNumber: digits.length >= 10 ? digits.slice(3, 10) : digits,
            personFirstName: firstName,
            personLastName: lastName,
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
          return jsonResponse({ due_date: '', due_time: '', assignedTo: '' }, 200, origin);
        }

        // Resolve assigned user ID to name
        let assignedTo = '';
        if (activity.user_id) {
          try {
            const userJson = await pipedrive(`/users/${activity.user_id}`, env.PIPEDRIVE_API_TOKEN);
            assignedTo = userJson.data?.name || '';
          } catch (e) { /* ignore */ }
        }

        return jsonResponse({
          due_date: activity.due_date || '',
          due_time: activity.due_time || '',
          assignedTo,
        }, 200, origin);
      }

      // --- GET /jotform-fields/:formId — JotForm form field QIDs ---
      const jfMatch = url.pathname.match(/^\/jotform-fields\/(\d+)$/);
      if (jfMatch) {
        const formId = jfMatch[1];
        const resp = await fetch(`https://eu-api.jotform.com/form/${formId}/questions?apiKey=${env.JOTFORM_API_KEY}`);
        if (!resp.ok) throw new Error(`JotForm API error: ${resp.status}`);
        const json = await resp.json();
        const questions = json.content || {};
        // Return map of { uniqueName: { qid, type, text } }
        const fields = {};
        for (const [qid, q] of Object.entries(questions)) {
          if (q.name) {
            fields[q.name] = { qid, type: q.type, text: q.text };
          }
        }
        return jsonResponse(fields, 200, origin);
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
