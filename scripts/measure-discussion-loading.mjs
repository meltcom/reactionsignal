import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {performance} from 'node:perf_hooks';
const before=execFileSync('git',['show','origin/main:dashboard.js'],{encoding:'utf8'}),after=await readFile('dashboard.js','utf8');
const results=[];
for(const [mode,source] of [['main',before],['candidate',after]])for(let trial=1;trial<=5;trial++){
 const nodes=new Map(),started=performance.now(),events={};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{open:false,reset(){},showModal(){this.open=true;},textContent:'',innerHTML:'',value:'',scrollTop:0});return nodes.get(id);};
 const context={catalog:{videos:[{id:'sample',performerId:'missioned-souls',title:'Sample reaction',channelName:'Sample reactor'}]},activeCommunityReactor:null,activeCommunityVideo:null,dialogRequest:0,commentParent:null,commentEdit:null,prefs:{autoplay:false},communityState:{name:'Sample'},$:node,setDiscussionMode(){},renderVideoDiscussionHeading(){},renderVideoActions(){},renderModeratorFormat(){},communityScore(){return ''},
 communityApi:async()=>{events.ratingStart=performance.now()-started;await new Promise(r=>setTimeout(r,180));events.ratingDone=performance.now()-started;return {rating:4};},
 loadComments:async()=>{events.commentsStart=performance.now()-started;await new Promise(r=>setTimeout(r,120));events.commentsDone=performance.now()-started;}};
 let code='';if(mode==='candidate')code=source.slice(source.indexOf('async function loadVideoDiscussion('),source.indexOf('openCommunityVideo=async function(id,performer)'));
 const start=source.indexOf('openCommunityVideo=async function(id,performer)');code+=source.slice(start,source.indexOf('\n',start));
 runInNewContext(code,context);await context.openCommunityVideo('sample','missioned-souls');
 results.push({mode,trial,...Object.fromEntries(Object.entries(events).map(([k,v])=>[k,Math.round(v)])),completeMs:Math.round(performance.now()-started)});
}
const mean=mode=>Math.round(results.filter(r=>r.mode===mode).reduce((s,r)=>s+r.completeMs,0)/5);
const report={scope:'Controlled local VM execution of actual main/candidate openCommunityVideo functions; rating delay 180ms, comments delay 120ms; five trials each. Excludes network, database, authentication and browser rendering. Not production performance.',mainMeanMs:mean('main'),candidateMeanMs:mean('candidate'),results};
await mkdir('output',{recursive:true});
await writeFile('output/discussion-loading-measurements.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
