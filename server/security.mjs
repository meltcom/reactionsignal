// Start with a short, host-only HSTS lifetime. Do not preload other subdomains.
const productionHosts=new Set(['reactionjourney.com','www.reactionjourney.com']);
export function secureRedirect(request){
 const url=new URL(request.url);
 if(url.protocol!=='http:'||!productionHosts.has(url.hostname))return null;
 url.protocol='https:';url.port='';
 return new Response(null,{status:308,headers:{Location:url.href,'Cache-Control':'no-store'}});
}
export function secureResponse(request,original){
 const response=new Response(original.body,{status:original.status,statusText:original.statusText,headers:new Headers(original.headers)});
 if(new URL(request.url).protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=86400');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('X-Frame-Options','DENY');
 response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 response.headers.set('Content-Security-Policy',"base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
 // Observe stricter rules before enforcing them against sign-in, inline UI and embeds.
 response.headers.set('Content-Security-Policy-Report-Only',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https://ovmvnfcbwirocsmtvaxd.supabase.co wss://ovmvnfcbwirocsmtvaxd.supabase.co https://cloudflareinsights.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com; font-src 'self' data:; worker-src 'self'; manifest-src 'self'");
 return response;
}
