import {readFile} from 'node:fs/promises';

const config=JSON.parse(await readFile(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
const previewDatabase='ba7d7d84-6947-4bfc-9270-03d63ee699af';
const requiredBuild='node scripts/check-preview-config.mjs && node scripts/build.mjs && node --test tests/*.test.mjs && node scripts/check-build.mjs';
const validDatabase=list=>list?.length===1&&list[0].binding==='DB'&&list[0].database_id===previewDatabase;

if(config.name!=='reactionsignal'||config.main!=='dist/server/index.js'||config.routes?.length||config.route||config.triggers?.crons?.length)throw Error('Preview must target only the unscheduled reactionsignal Worker without production routes.');
if(!validDatabase(config.d1_databases)||!validDatabase(config.previews?.d1_databases))throw Error('Preview must use the isolated preview database at top level and in Preview settings.');
if(String(config.vars?.DISCOVERY_DAILY_SEARCH_LIMIT)!=='0'||String(config.previews?.vars?.DISCOVERY_DAILY_SEARCH_LIMIT)!=='0'||!config.vars?.MEMBER_EMAIL_ALLOWLIST||!config.previews?.vars?.MEMBER_EMAIL_ALLOWLIST||config.vars?.YOUTUBE_PUSH_CALLBACK_URL||config.previews?.vars?.YOUTUBE_PUSH_CALLBACK_URL)throw Error('Preview requires restricted membership, disabled discovery and disabled push.');
if(config.build?.command!==requiredBuild)throw Error('Preview build and regression gates are required.');
console.log('Preview target, isolated database, restricted settings and build gates verified.');
