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

    const match = url.pathname.match(/^\/deal-fields\/(\d+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Not found. Use /deal-fields/:id' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const fieldId = match[1];

    try {
      const apiUrl = `https://api.pipedrive.com/v1/dealFields/${fieldId}?api_token=${env.PIPEDRIVE_API_TOKEN}`;
      const resp = await fetch(apiUrl);

      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Pipedrive API error: ${resp.status}` }), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      const json = await resp.json();
      const field = json.data;

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
