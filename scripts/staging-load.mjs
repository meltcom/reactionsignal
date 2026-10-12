// Opt-in authenticated read-only test of an isolated preview. No production targets.
import {performance} from 'node:perf_hooks';
const target=new URL(process.env.RELEASE_STAGING_URL||'http://invalid');
if(target.protocol!=='https:'||!target.hostname.endsWith('.workers.dev')||!/(preview|staging|public-release)/.test(target.hostname)||target.username||target.password)throw Error('Set RELEASE_STAGING_URL to an isolated preview/staging workers.dev URL.');
const tokens=JSON.parse(process.env.RELEASE_STAGING_TOKENS||'[]');
if(!tokens.length||tokens.some(t=>typeof t!=='string'||!t))throw Error('Provide RELEASE_STAGING_TOKENS as a JSON array of test-member access tokens.');
let next=0;const latency=[],statuses={},started=performance.now();
await Promise.all(Array.from({length:20},async()=>{while(next<200){const i=next++,begin=performance.now(),paths=['/data.json','/api/community/summary','/api/social/dashboard'];const r=await fetch(new URL(paths[i%3],target),{headers:{Authorization:'Bearer '+tokens[i%tokens.length]},redirect:'error',signal:AbortSignal.timeout(10000)});statuses[r.status]=(statuses[r.status]||0)+1;await r.arrayBuffer();latency.push(performance.now()-begin);}}));
latency.sort((a,b)=>a-b);console.log(JSON.stringify({scope:'Isolated staging, authenticated reads only',requests:200,concurrency:20,durationMs:Math.round(performance.now()-started),p95Ms:Math.round(latency[Math.floor(latency.length*.95)]),statuses},null,2));
if(Object.keys(statuses).some(s=>s!=='200'))process.exitCode=1;
