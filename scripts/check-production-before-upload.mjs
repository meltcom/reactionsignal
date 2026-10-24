import {pathToFileURL} from 'node:url';
import {assertSameDeployment} from './release-provenance.mjs';

export async function verifyProductionBeforeUpload({expected,token,fetcher=fetch}){
 if(!Array.isArray(expected)||!expected.length||!token)throw Error('Missing guarded release context. Use npm run deploy; direct production uploads are stopped.');
 const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/2490ea18350eaad3ff9e27d01e44f3b1/workers/scripts/reactionsignal/deployments',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)
 });
 const data=await response.json();
 const actual=data.result?.deployments?.[0]?.versions;
 if(!response.ok||!data.success||!Array.isArray(actual)||!actual.length)throw Error('Cannot verify production immediately before upload; release stopped.');
 assertSameDeployment(expected,actual);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let expected;try{expected=JSON.parse(process.env.REACTION_EXPECTED_DEPLOYMENT||'null');}catch{throw Error('Invalid guarded release context.');}
 await verifyProductionBeforeUpload({expected,token:process.env.REACTION_UPLOAD_CHECK_TOKEN});
 console.log('Production versions unchanged after Wrangler build and regression checks.');
}
