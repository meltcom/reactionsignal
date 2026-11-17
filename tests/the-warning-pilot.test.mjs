import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../sites/band-site/worker.mjs';
import {sites} from '../sites/band-site/site-config.mjs';

test('the warning configuration is available with unique reaction IDs', ()=>{
  const site=sites['the-warning'];
  assert.equal(site.id,'the-warning');
  assert.ok(site.entries.length>=4);
  assert.equal(new Set(site.entries.map(e=>e.id)).size,site.entries.length);
  assert.ok(site.entries.every(e=>/^[a-zA-Z0-9_-]{11}$/.test(e.id)));
});
test('API is scoped to selected band and has no production member or payment features',async()=>{
  const env={SITE_KEY:'the-warning'};
  const req=p=>new Request('https://thewarning.reactionjourney.com'+p);
  const config=await app.fetch(req('/api/config'),env);
  assert.equal(config.status,200);
  const c=await config.json();
  assert.equal(c.id,'the-warning');
  assert.equal(c.entries,undefined);
  const catalog=await app.fetch(req('/api/catalog'),env);
  assert.equal(catalog.status,200);
  const data=await catalog.json();
  assert.equal(data.site,'the-warning');
  assert.equal(data.count,sites['the-warning'].entries.length);
  assert.ok(data.entries.every(e=>e.url.startsWith('https://www.youtube.com/watch?v=')));
  const payments=await app.fetch(req('/api/billing'),env);
  assert.equal(payments.status,404);
  const post=await app.fetch(new Request('https://thewarning.reactionjourney.com/api/catalog',{method:'POST'}),env);
  assert.equal(post.status,405);
});
test('misconfiguration fails closed; no fallback to the Missioned Souls environment',async()=>{
  const response=await app.fetch(new Request('https://thewarning.reactionjourney.com/api/catalog'),{});
  assert.equal(response.status,503);
  const data=await response.json();
  assert.match(data.error,/configuration/i);
});
test('static responses are given security headers',async()=>{
  const request=new Request('https://thewarning.reactionjourney.com/');
  const response=await app.fetch(request,{
    SITE_KEY:'the-warning',
    ASSETS:{fetch:async()=>new Response('page',{headers:{'Content-Type':'text/html'}})}
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
