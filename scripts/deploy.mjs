import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSameDeployment,assertRelease} from './release-provenance.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
function run(command,args){
 const result=spawnSync(command,args,{stdio:'inherit',shell:false});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(command+' failed; release stopped.');
}
const npx=process.platform==='win32'?'npx.cmd':'npx';
// npm/npx .cmd require the Windows command processor; arguments here are fixed literals.
function wrangler(args){
 if(process.platform==='win32')run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx --yes wrangler@4 '+args.join(' ')]);
 else run(npx,['--yes','wrangler@4',...args]);
}
const allowDirty=process.argv.includes('--allow-dirty');
run(process.execPath,['scripts/check-release-checkout.mjs',...(allowDirty?['--allow-dirty']:[])]);
if(allowDirty)process.env.REACTION_ALLOW_DIRTY_RELEASE='1';
const sourceCommit=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
wrangler(['whoami']); // Refresh the existing login before reading its token.
let token=process.env.CLOUDFLARE_API_TOKEN;
if(!token){
 const path=process.env.WRANGLER_CONFIG_PATH||(process.platform==='win32'?join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml'):join(process.env.XDG_CONFIG_HOME||join(process.env.HOME,'.config'),'.wrangler','config','default.toml'));
 const config=await readFile(path,'utf8');token=config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
}
if(!token)throw Error('Cloudflare credentials unavailable.');
const base='https://api.cloudflare.com/client/v4/accounts/2490ea18350eaad3ff9e27d01e44f3b1/workers/scripts/reactionsignal';
async function active(){
 const response=await fetch(base+'/deployments',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||!data.success||!data.result?.deployments?.[0]?.versions?.length)throw Error('Cannot verify active production versions; deployment stopped.');
 return data.result.deployments[0].versions;
}
const before=await active();
console.log('Active production versions: '+JSON.stringify(before));
await mkdir('output',{recursive:true});
const attempt={sourceCommit,before,startedAt:new Date().toISOString(),stage:'preparing',browserVerification:'NOT RUN'};
const saveAttempt=()=>writeFile('output/last-deployment-attempt.json',JSON.stringify(attempt,null,2));
await saveAttempt();
// Always build from source, never from a downloaded legacy Worker or tmp/ bundle.
run(process.execPath,['scripts/build.mjs']);
const regressionTests=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
run(process.execPath,['--test',...regressionTests]);
run(process.execPath,['scripts/check-build.mjs']);
assertSameDeployment(before,await active());
const checked=JSON.parse(await readFile('dist/release.json','utf8'));
process.env.REACTION_EXPECTED_SOURCE_HASH=checked.sourceHash;
attempt.checkedRelease=checked;attempt.stage='checked';await saveAttempt();
process.env.REACTION_EXPECTED_DEPLOYMENT=JSON.stringify(before);
process.env.REACTION_UPLOAD_CHECK_TOKEN=token;
wrangler(['deploy','--keep-vars']);
delete process.env.REACTION_UPLOAD_CHECK_TOKEN;
run(process.execPath,['scripts/check-build.mjs']);
const expected=JSON.parse(await readFile('dist/release.json','utf8'));
const deployed=await active();
if(deployed.length!==1||deployed[0].percentage!==100||deployed[0].version_id===before[0].version_id)throw Error('Deployment did not activate one new production version.');
attempt.deployed=deployed;attempt.release=expected;attempt.stage='uploaded';await saveAttempt();
let verified=false;
for(let attempt=0;attempt<5;attempt++){
 try{
  const response=await fetch('https://reactionjourney.com/release.json?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Release metadata unavailable');
  assertRelease(expected,await response.json());verified=true;break;
 }catch(error){if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}
}
if(!verified)throw Error('Live release verification failed.');
assertSameDeployment(deployed,await active());
attempt.stage='identity-verified';attempt.browserVerification='REQUIRED: real signed-in browser check';await saveAttempt();
await mkdir('output',{recursive:true});
await writeFile('output/last-deployment.json',JSON.stringify({sourceCommit,before,deployed,release:expected,browserVerification:'REQUIRED: sign in and confirm My Feed renders videos, current interface, and requested change.'},null,2));
console.log('Live build verified. Active version: '+deployed[0].version_id);
console.log('NOT YET FUNCTIONALLY VERIFIED: open production signed in; confirm My Feed displays videos and current interface before reporting success.');
