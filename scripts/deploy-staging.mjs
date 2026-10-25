import {spawnSync,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {assertStagingConfig,stagingName} from './staging-config.mjs';import {assertSameDeployment,assertRelease} from './release-provenance.mjs';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git(['status','--porcelain','--untracked-files=normal']))throw Error('Commit the reviewed staging scope before deploying.');
assertStagingConfig(JSON.parse(await readFile('wrangler.staging.jsonc','utf8')));
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit',shell:false});if(r.error)throw r.error;if(r.status!==0)throw Error('Staging command failed; stopped.');}
function wrangler(args){if(process.platform==='win32')run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx --yes wrangler@4 '+args.join(' ')]);else run('npx',['--yes','wrangler@4',...args]);}
wrangler(['whoami']);let token=process.env.CLOUDFLARE_API_TOKEN;
if(!token){const path=process.env.WRANGLER_CONFIG_PATH||(process.platform==='win32'?join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'):join(process.env.XDG_CONFIG_HOME||join(process.env.HOME,'.config'),'.wrangler','config','default.toml'));const c=await readFile(path,'utf8');token=c.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];}
if(!token)throw Error('Cloudflare login required.');
const account='https://api.cloudflare.com/client/v4/accounts/2490ea18350eaad3ff9e27d01e44f3b1';
async function api(path,{missing=false}={}){const r=await fetch(account+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});if(r.status===404&&missing)return null;const d=await r.json();if(!r.ok||!d.success)throw Error('Cannot verify staging/provider state: '+r.status);return d.result;}
async function active(name,missing=false){return (await api('/workers/scripts/'+name+'/deployments',{missing}))?.deployments?.[0]?.versions||[];}
const productionBefore=await active('reactionsignal');if(!productionBefore.length)throw Error('Production reference unavailable.');
const stagingBefore=await active(stagingName,true),subdomain=(await api('/workers/subdomain')).subdomain;
if(!/^[a-z0-9-]+$/.test(subdomain))throw Error('Invalid account subdomain.');
const attempt={sourceCommit:git(['rev-parse','HEAD']),productionBefore,stagingBefore,startedAt:new Date().toISOString(),stage:'preparing',browserVerification:'NOT RUN'};
await mkdir('output',{recursive:true});const save=()=>writeFile('output/last-staging-deployment.json',JSON.stringify(attempt,null,2));await save();
run(process.execPath,['scripts/build.mjs']);run(process.execPath,['--test','tests/*.test.mjs']);run(process.execPath,['scripts/check-build.mjs']);
assertSameDeployment(productionBefore,await active('reactionsignal'));
const checked=JSON.parse(await readFile('dist/release.json','utf8'));process.env.REACTION_EXPECTED_SOURCE_HASH=checked.sourceHash;
attempt.stage='checked';attempt.checkedRelease=checked;await save();
wrangler(['deploy','--config','wrangler.staging.jsonc','--keep-vars']);
run(process.execPath,['scripts/check-build.mjs']);
const expected=JSON.parse(await readFile('dist/release.json','utf8')),deployed=await active(stagingName);
attempt.stage='uploaded';attempt.deployed=deployed;attempt.release=expected;await save();
assertSameDeployment(productionBefore,await active('reactionsignal'));
if(deployed.length!==1||deployed[0].percentage!==100||stagingBefore.some(v=>v.version_id===deployed[0].version_id))throw Error('Unexpected staging active version.');
const url='https://'+stagingName+'.'+subdomain+'.workers.dev';
const r=await fetch(url+'/release.json?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Staging release identity unavailable.');assertRelease(expected,await r.json());
attempt.url=url;attempt.stage='identity-verified';attempt.browserVerification='REQUIRED: sign in and verify real feed and discussion';await save();
console.log('Staging identity verified: '+url);console.log('Production active versions unchanged. Signed-in browser verification remains required.');
