import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import {sourceFingerprint,artifactFingerprint} from './release-provenance.mjs';
const root=new URL('../',import.meta.url);
const sourceHash=await sourceFingerprint(fileURLToPath(root));
if(process.env.REACTION_EXPECTED_SOURCE_HASH&&process.env.REACTION_EXPECTED_SOURCE_HASH!==sourceHash)throw Error('Source changed after release checks; deployment stopped.');
const release={schema:1,sourceHash,builtAt:new Date().toISOString()};
// Only replace this project's reproducible build output.
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(new URL('dist/server/',root),{recursive:true});
const assets={};for(const [name,type] of [['signin.css','text/css; charset=utf-8'],['about.html','text/html; charset=utf-8'],['operations-ui.js','text/javascript; charset=utf-8'],['missioned-souls.js','text/javascript; charset=utf-8'],['missioned-souls-core.mjs','text/javascript; charset=utf-8'],['missioned-souls.css','text/css; charset=utf-8'],['privacy.html','text/html; charset=utf-8'],['terms.html','text/html; charset=utf-8'],['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['community.js','text/javascript; charset=utf-8'],['moderator-queue.js','text/javascript; charset=utf-8'],['dashboard.js','text/javascript; charset=utf-8'],['dashboard.css','text/css; charset=utf-8'],['performers.js','text/javascript; charset=utf-8'],['launch-review.js','text/javascript; charset=utf-8'],['contact.js','text/javascript; charset=utf-8'],['channels.js','text/javascript; charset=utf-8'],['user-activity.js','text/javascript; charset=utf-8'],['activity-tracking.js','text/javascript; charset=utf-8']])assets[`/${name}`]={type,body:await readFile(new URL(name,root),'utf8')};
for(const name of ['reaction-journey-app-logo','reaction-journey-logo-small','reaction-journey-app-logo-small','ms-journey-logo-small','sunset-coastal-highway-badge-small','dan-mccann-community-champion','brian-carroll-community-champion','jack-community-champion','reaction-journey-coastal-header'])assets['/images/'+name+'.webp']={type:'image/webp',base64:(await readFile(new URL('images/'+name+'.webp',root))).toString('base64')};
assets['/images/ms-moon-logo.png']={type:'image/png',base64:(await readFile(new URL('images/ms-moon-logo.png',root))).toString('base64')};
assets['/images/reaction-journey-logo.png']={type:'image/png',base64:(await readFile(new URL('images/reaction-journey-logo.png',root))).toString('base64')};
assets['/ms-journey-logo.png']={type:'image/png',base64:(await readFile(new URL('ms-journey-logo.png',root))).toString('base64')};
assets['/images/sunset-coastal-highway-badge.png']={type:'image/png',base64:(await readFile(new URL('images/sunset-coastal-highway-badge.png',root))).toString('base64')};
const {build}=await import('esbuild');
const authBundle=await build({entryPoints:[fileURLToPath(new URL('auth-client.js',root))],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true});
assets['/auth-client.js']={type:'text/javascript; charset=utf-8',body:authBundle.outputFiles[0].text};
const importBundle=await build({entryPoints:[fileURLToPath(new URL('workbook-import.js',root))],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true});
assets['/workbook-import.js']={type:'text/javascript; charset=utf-8',body:importBundle.outputFiles[0].text};
const youtubeBundle=await build({entryPoints:[fileURLToPath(new URL('youtube-subscriptions.js',root))],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true});
assets['/youtube-subscriptions.js']={type:'text/javascript; charset=utf-8',body:youtubeBundle.outputFiles[0].text};

for(const [name,type] of [['mobile-app.js','text/javascript; charset=utf-8'],['mobile-app.css','text/css; charset=utf-8'],['offline.html','text/html; charset=utf-8'],['app.webmanifest','application/manifest+json']])assets['/'+name]={type,body:await readFile(new URL(name,root),'utf8')};
for(const name of ['app-192','app-512','app-maskable','app-apple'])assets['/images/'+name+'.png']={type:'image/png',base64:(await readFile(new URL('images/'+name+'.png',root))).toString('base64')};
assets['/member-guides.js']={type:'text/javascript; charset=utf-8',body:await readFile(new URL('member-guides.js',root),'utf8')};
for(const name of ['reaction-journey-overview.pdf','reaction-journey-app-guide.pdf'])assets['/private-guides/'+name]={type:'application/pdf',base64:(await readFile(new URL('member-guides/'+name,root))).toString('base64')};
const {createHash}=await import('node:crypto');
const journeyBundle=await build({entryPoints:[fileURLToPath(new URL('journey-interface.mjs',root))],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true});
assets['/journey-interface.js']={type:'text/javascript; charset=utf-8',body:journeyBundle.outputFiles[0].text};
assets['/journey-interface.css']={type:'text/css; charset=utf-8',body:await readFile(new URL('journey-interface.css',root),'utf8')};
const workerSource=await readFile(new URL('service-worker.js',root),'utf8');
const version=createHash('sha256').update(JSON.stringify(assets)+workerSource).digest('hex').slice(0,16);
assets['/service-worker.js']={type:'text/javascript; charset=utf-8',body:workerSource.replaceAll('__APP_VERSION__',version)};

await copyFile(new URL('youtube-subscriptions-core.js',root),new URL('dist/youtube-subscriptions-core.js',root));
const seed=JSON.parse(await readFile(new URL('data.json',root),'utf8'));
seed.missionedSouls=JSON.parse(await readFile(new URL('missioned-souls-seed.json',root),'utf8'));
seed.importRun=JSON.parse(await readFile(new URL('import-run.json',root),'utf8'));
assets['/release.json']={type:'application/json; charset=utf-8',body:JSON.stringify(release)};
await writeFile(new URL('dist/release.json',root),JSON.stringify(release));
await writeFile(new URL('dist/server/assets.mjs',root),`export const assets=${JSON.stringify(assets)};\nexport const seed=${JSON.stringify(seed)};\n`);
for(const f of ['view-settings.mjs','discovery-measurement.mjs','official-feed.mjs','cache.mjs','operations.mjs','rss.mjs','youtube-subscriptions.mjs','youtube-connection.mjs','db.mjs','discovery.mjs','video-format.mjs','format-recheck.mjs','video-metadata.mjs','approval-rules.mjs','channel-stats.mjs','community.mjs','ms-discussion.mjs','reputation.mjs','social.mjs','auth.mjs','performers.mjs','push.mjs','recheck.mjs','workbook-import.mjs','reconciliation.mjs'])await copyFile(new URL(`server/${f}`,root),new URL(`dist/server/${f}`,root));
await build({entryPoints:[fileURLToPath(new URL('server/missioned-souls.mjs',root))],outfile:fileURLToPath(new URL('dist/server/missioned-souls.mjs',root)),bundle:true,format:'esm',platform:'neutral',target:'es2022'});
await copyFile(new URL('server/security.mjs',root),new URL('dist/server/security.mjs',root));
await copyFile(new URL('server/worker.mjs',root),new URL('dist/server/index.js',root));
await writeFile(new URL('dist/build-integrity.json',root),JSON.stringify({sha256:await artifactFingerprint(fileURLToPath(new URL('dist/',root)))}));
if(await sourceFingerprint(fileURLToPath(root))!==sourceHash)throw Error('Source changed during build; rebuild before deployment.');
console.log('Built Reaction Journey. Release '+sourceHash);
// Database migrations are intentionally separate from builds and presentation releases.

