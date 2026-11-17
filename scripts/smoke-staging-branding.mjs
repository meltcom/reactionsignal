#!/usr/bin/env node
// Post-deployment, read-only checks for the restricted Cloudflare staging site.
// Usage: node scripts/smoke-staging-branding.mjs https://reactionsignal-staging.<account>.workers.dev
import assert from 'node:assert/strict';

const address=process.argv[2];
if(!address)throw Error('Supply the staging workers.dev URL.');
const origin=new URL(address);
assert.equal(origin.protocol,'https:');
assert.match(origin.hostname,/^reactionsignal-staging\.[a-z0-9-]+\.workers\.dev$/i,'Only the staging Worker may be checked');
const read=async(path)=>{
 const response=await fetch(new URL(path,origin),{redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,path+' must return HTTP 200');
 return response;
};
const release=await (await read('/release.json')).json();
assert.ok(release.sourceHash,'Staging release identity missing');
const html=await (await read('/')).text();
for(const required of [
 'class="brand" href="#feed"',
 'class="ms-header-link" href="#missioned-souls"',
 'class="ms-logo-title"><a href="#missioned-souls"',
 'src="/images/ms-moon-logo-optimized.webp"',
 'src="/images/reaction-journey-logo-small.webp"',
 'id="feed-countdown"'
])assert.ok(html.includes(required),'Missing navigation or branding markup: '+required);
for(const asset of ['/images/ms-moon-logo-optimized.webp','/images/ms-journey-logo-small.webp','/images/reaction-journey-logo-small.webp']){
 const response=await read(asset);
 assert.match(response.headers.get('content-type')||'',/image\/webp/i,asset+' must have a WebP content type');
 const bytes=new Uint8Array(await response.arrayBuffer());
 assert.equal(String.fromCharCode(...bytes.slice(8,12)),'WEBP',asset+' must contain WebP image data');
 assert.ok(bytes.length<100000,asset+' exceeds 100 KB');
}
const countdown=await (await read('/countdown.js')).text();
assert.ok(countdown.includes('placeOnCurrentPage'),'Site-wide countdown behavior missing');
assert.ok(countdown.includes("if(window.reactionAuth?.account)void refresh()"),'Countdown does not refresh on page changes');
const style=await (await read('/countdown.css')).text();
assert.ok(style.includes('countdown-banner-active'),'Responsive banner style missing');
console.log('PASS: staging release '+release.sourceHash+', original MS moon WebP, RJ/MS navigation, countdown assets');
console.log('Still requires signed-in visual and functional browser tests: timer enable/disable, ticking, event link, zero-time state, mobile wrapping, and page transitions.');
