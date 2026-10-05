import { mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
// Only replace this project's reproducible build output.
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(new URL('dist/server/',root),{recursive:true});
const assets={};for(const [name,type] of [['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['community.js','text/javascript; charset=utf-8'],['dashboard.js','text/javascript; charset=utf-8'],['dashboard.css','text/css; charset=utf-8'],['performers.js','text/javascript; charset=utf-8'],['launch-review.js','text/javascript; charset=utf-8'],['contact.js','text/javascript; charset=utf-8'],['channels.js','text/javascript; charset=utf-8']])assets[`/${name}`]={type,body:await readFile(new URL(name,root),'utf8')};
assets['/images/reaction-journey-logo.png']={type:'image/png',base64:(await readFile(new URL('images/reaction-journey-logo.png',root))).toString('base64')};
const {build}=await import('esbuild');
const authBundle=await build({entryPoints:[new URL('auth-client.js',root).pathname],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true});
assets['/auth-client.js']={type:'text/javascript; charset=utf-8',body:authBundle.outputFiles[0].text};
const seed=JSON.parse(await readFile(new URL('data.json',root),'utf8'));
seed.importRun=JSON.parse(await readFile(new URL('import-run.json',root),'utf8'));
await writeFile(new URL('dist/server/assets.mjs',root),`export const assets=${JSON.stringify(assets)};\nexport const seed=${JSON.stringify(seed)};\n`);
for(const f of ['db.mjs','discovery.mjs','community.mjs','social.mjs','auth.mjs','performers.mjs','push.mjs','recheck.mjs'])await copyFile(new URL(`server/${f}`,root),new URL(`dist/server/${f}`,root));
await copyFile(new URL('server/worker.mjs',root),new URL('dist/server/index.js',root));
console.log('Built Reaction Journey for direct Cloudflare Workers hosting.');
