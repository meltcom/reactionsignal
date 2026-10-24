import {readFile} from 'node:fs/promises';import {assertStagingConfig} from './staging-config.mjs';
assertStagingConfig(JSON.parse(await readFile(new URL('../wrangler.staging.jsonc',import.meta.url),'utf8')));
console.log('Staging target, database and build gates verified.');
