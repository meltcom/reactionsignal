import { sites } from './site-config.mjs';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests",
};
function reply(request, data, status = 200) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(data), {
    status,
    headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'public, max-age=300', ...securityHeaders}
  });
}
function withSecurity(request, response) {
  const headers = new Headers(response.headers);
  for (const [key,value] of Object.entries(securityHeaders)) headers.set(key,value);
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security','max-age=86400');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
export default {
  async fetch(request, env) {
    const site = sites[String(env.SITE_KEY || '')];
    if (!site) return reply(request,{error:'Site configuration is unavailable.'},503);
    if (!['GET','HEAD'].includes(request.method)) return reply(request,{error:'Method not allowed.'},405);
    const path = new URL(request.url).pathname;
    if (path === '/api/health') return reply(request,{status:'ok', site:site.id, mode:'read-only-pilot'});
    if (path === '/api/config') {
      const {entries,...config} = site;
      return reply(request,config);
    }
    if (path === '/api/catalog') {
      return reply(request, {
        site:site.id,
        count:site.entries.length,
        kind:'curated-starter-catalog',
        lastLiveCheckedAt:null,
        entries:site.entries.map(entry=>({
          ...entry,
          url:'https://www.youtube.com/watch?v='+entry.id,
          thumbnail:'https://i.ytimg.com/vi/'+entry.id+'/hqdefault.jpg'
        }))
      });
    }
    if (path.startsWith('/api/')) return reply(request,{error:'Not found.'},404);
    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return reply(request,{error:'Static assets are not configured.'},503);
    const response = await env.ASSETS.fetch(request);
    return withSecurity(request,response);
  }
};
