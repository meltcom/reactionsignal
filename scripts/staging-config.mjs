export const stagingName='reactionsignal-staging';
export const previewDatabase='ba7d7d84-6947-4bfc-9270-03d63ee699af';
export function assertStagingConfig(config){
 if(config.name!==stagingName||config.main!=='dist/server/index.js'||config.routes?.length||config.route||config.triggers?.crons?.length)throw Error('Staging must target only the isolated unscheduled Worker.');
 const db=config.d1_databases;
 if(db?.length!==1||db[0].binding!=='DB'||db[0].database_id!==previewDatabase)throw Error('Staging must use the verified preview database.');
 if(String(config.vars?.DISCOVERY_DAILY_SEARCH_LIMIT)!=='0'||!config.vars?.MEMBER_EMAIL_ALLOWLIST||config.vars?.YOUTUBE_PUSH_CALLBACK_URL)throw Error('Staging requires restricted test membership and disabled discovery/push.');
 if(config.build?.command!=='node scripts/check-staging-config.mjs && node scripts/build.mjs && node --test tests/*.test.mjs && node scripts/check-build.mjs')throw Error('Staging build and regression gates are required.');
}
