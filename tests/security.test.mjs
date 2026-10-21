import {test} from 'node:test';
import assert from 'node:assert/strict';
import {secureRedirect,secureResponse} from '../server/security.mjs';
test('production HTTP redirects preserve path and query without processing requests',()=>{
 for(const host of ['reactionjourney.com','www.reactionjourney.com']){
  const result=secureRedirect(new Request(`http://${host}/api/youtube/subscriptions/callback?code=test&state=example`));
  assert.equal(result.status,308);assert.equal(result.headers.get('Location'),`https://${host}/api/youtube/subscriptions/callback?code=test&state=example`);
 }
 assert.equal(secureRedirect(new Request('http://localhost:8787/')),null);
 assert.equal(secureRedirect(new Request('https://reactionjourney.com/')),null);
});
test('headers protect HTTPS errors and retain cookies, status and body',async()=>{
 const original=new Response('Sign in',{status:401,headers:{'Set-Cookie':'state=test; Secure; HttpOnly','Cache-Control':'no-store'}});
 const result=secureResponse(new Request('https://reactionjourney.com/api/status'),original);
 assert.equal(result.status,401);assert.equal(await result.text(),'Sign in');
 assert.equal(result.headers.get('Cache-Control'),'no-store');assert.match(result.headers.get('Set-Cookie'),/HttpOnly/);
 assert.equal(result.headers.get('Strict-Transport-Security'),'max-age=86400');
 assert.equal(result.headers.get('X-Frame-Options'),'DENY');
 assert.match(result.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.ok(!result.headers.get('Content-Security-Policy').includes('script-src'));
 assert.match(result.headers.get('Content-Security-Policy-Report-Only'),/script-src/);
 assert.equal(secureResponse(new Request('http://localhost/'),new Response('local')).headers.get('Strict-Transport-Security'),null);
});
