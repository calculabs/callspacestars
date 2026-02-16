const ALLOWED_ORIGINS = [
  'https://calculabs.github.io',
  'https://form.jotform.com',
  'https://www.jotform.com',
  'https://submit.jotform.com',
  'https://eu.jotform.com',
];

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const match = url.pathname.match(/^\/deal-fields\/([a-fA-F0-9]+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Not found. Use /deal-fields/:key' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const fieldKey = match[1];
    const isNumeric = /^\d+$/.test(fieldKey);

    try {
      let field;

      if (isNumeric) {
        // Direct lookup by numeric ID
        const apiUrl = `https://api.pipedrive.com/v1/dealFields/${fieldKey}?api_token=${env.PIPEDRIVE_API_TOKEN}`;
        const resp = await fetch(apiUrl);
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: `Pipedrive API error: ${resp.status}` }), {
            status: resp.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }
        const json = await resp.json();
        field = json.data;
      } else {
        // Lookup by API key — fetch all deal fields and find by key
        const apiUrl = `https://api.pipedrive.com/v1/dealFields?api_token=${env.PIPEDRIVE_API_TOKEN}`;
        const resp = await fetch(apiUrl);
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: `Pipedrive API error: ${resp.status}` }), {
            status: resp.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }
        const json = await resp.json();
        field = (json.data || []).find(f => f.key === fieldKey);
        if (!field) {
          return new Response(JSON.stringify({ error: 'Field not found for key: ' + fieldKey }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }
      }

      const stripped = {
        id: field.id,
        name: field.name,
        field_type: field.field_type,
        options: field.options || [],
      };

      return new Response(JSON.stringify(stripped), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
