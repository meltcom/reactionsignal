import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
function fixture(){
 const select={value:'specific',option:{},querySelector(){return this.option;}},help={};
 const dashboard={follows:[],followingGroups:[],hiddenReactors:[],views:[{id:'saved'}],watch:[]};
 const videos=[{id:'reaction',channelId:'a',performerId:'ms',title:'Hysteria reaction',song:'Hysteria',publishedAt:'2026-10-19',format:'FULL_LENGTH',confidence:'CONFIRMED'},{id:'unfollowed',channelId:'b',performerId:'ms',title:'Other song',song:'Other song',publishedAt:'2026-10-18',format:'FULL_LENGTH',confidence:'CONFIRMED'},{id:'official',channelId:'official',performerId:'ms',title:'Hysteria',song:'Hysteria',isOfficial:true,publishedAt:'2026-10-17',format:'SHORT',confidence:'CONFIRMED'}];
 const c=vm.createContext({dashboard,videos,feedMode:'following',followingScope:'specific',followingControls:{querySelector:()=>help},
 state:{performer:'all',query:'',format:'all',confidence:'all',sort:'latest',visible:24},prefs:{fields:[],theme:'dark',landing:'following',defaultView:'saved'},
 follows:(kind,target)=>dashboard.follows.some(f=>f.kind===kind&&f.target===target),
 $:()=>select,feedVideos:()=>videos,channelFor:()=>({}),scoreMap:new Map(),reactorRankValue:()=>0,communityRank:()=>0,commentsFor:()=>0,
 escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 syncControls:()=>{},renderPerformers:()=>{},renderVideos:()=>{},notice:message=>c.message=message});
 vm.runInContext(source.slice(source.indexOf('function normalizeFollowSong('),source.indexOf('const followingControls=')),c);
 vm.runInContext(source.slice(source.indexOf('performerVideos=function()'),source.indexOf('function metadata(')),c);
 vm.runInContext(source.slice(source.indexOf('function clearFeedFilters()'),source.indexOf('function navigate(')),c);
 return {c,dashboard,select,help,ids:()=>Array.from(c.performerVideos(),v=>v.id)};
}
test('Following defaults to reactors and songs without falling back after the final unfollow',()=>{
 const {c,dashboard,ids}=fixture();dashboard.follows.push({kind:'performer',target:'ms'});
 assert.deepEqual(ids(),[]);
 dashboard.follows.push({kind:'reactor',target:'a'});assert.deepEqual(ids(),['reaction']);
 dashboard.follows.pop();assert.deepEqual(ids(),[]);
 c.followingScope='all';assert.deepEqual(ids(),['reaction','unfollowed','official']);
 assert.equal(c.followingReason(c.videos[1]),'Following this performer');
});
test('song follows cross channels intentionally, prefer catalog song and use whole phrases in title fallback',()=>{
 const {c,dashboard,ids}=fixture();dashboard.follows.push({kind:'song',target:'Hysteria'});
 assert.deepEqual(ids(),['reaction','official']);
 assert.equal(c.matchesFollowedSong({song:'Other song',title:'Hysteria reaction'},'Hysteria'),false);
 assert.equal(c.matchesFollowedSong({title:'Hysterical reaction'},'Hysteria'),false);
 assert.equal(c.matchesFollowedSong({title:'A reaction to TOTAL ECLIPSE OF THE HEART!'},'Total Eclipse of the Heart'),true);
 assert.equal(c.matchesFollowedSong({song:' HYSTERIA! '},'Hysteria'),true);
 assert.equal(c.matchesFollowedSong({title:'Anything'},' '),false);
});
test('active groups suppress performer-wide matching including official uploads, and empty groups stay empty',()=>{
 const {c,dashboard,select,ids}=fixture();dashboard.follows.push({kind:'performer',target:'ms'});dashboard.followingGroups.push({active:true});c.followingScope='all';
 assert.deepEqual(ids(),[]);c.syncFollowingScope();assert.equal(c.followingScope,'specific');assert.equal(select.option.disabled,true);
 dashboard.follows.push({kind:'reactor',target:'a'});assert.deepEqual(ids(),['reaction']);
 dashboard.followingGroups[0].active=false;c.syncFollowingScope();assert.equal(select.option.disabled,false);
});
test('match explanations follow scope, escape song names and give reactor priority',()=>{
 const {c,dashboard}=fixture();dashboard.follows.push({kind:'song',target:'<Hysteria>'});
 assert.match(c.followingMatchMarkup(c.videos[0]),/Following this song: &lt;Hysteria&gt;/);
 dashboard.follows.push({kind:'reactor',target:'a'});assert.match(c.followingMatchMarkup(c.videos[0]),/Following this reactor/);
 c.feedMode='all';assert.equal(c.followingMatchMarkup(c.videos[0]),'');
});
test('hidden reactors remain hidden regardless of the match or broader performer scope',()=>{
 const {c,dashboard,ids}=fixture();dashboard.follows.push({kind:'performer',target:'ms'});c.followingScope='all';dashboard.hiddenReactors.push({channel_id:'a'});
 assert.deepEqual(ids(),['unfollowed','official']);
});
test('Clear filters announces All, resets scope and pagination, and preserves stored personal data',()=>{
 const {c,dashboard}=fixture();dashboard.follows.push({kind:'reactor',target:'a'});const before=JSON.stringify(dashboard);c.followingScope='all';c.state.visible=96;
 c.clearFeedFilters();assert.equal(c.feedMode,'all');assert.equal(c.followingScope,'specific');assert.equal(c.state.visible,24);
 assert.match(c.message,/Switched to All/);assert.equal(JSON.stringify(dashboard),before);assert.equal(c.prefs.theme,'dark');assert.equal(c.prefs.defaultView,'saved');assert.equal(c.prefs.landing,'following');
});

test('cards, compact lists and tables render the matching reason for reactions and official uploads',()=>{
 const {c,dashboard,select}=fixture();dashboard.follows.push({kind:'reactor',target:'a'},{kind:'song',target:'Hysteria'});
 const elements=new Map();c.$=id=>{if(id==='followingScope')return select;if(!elements.has(id))elements.set(id,{querySelectorAll:()=>[]});return elements.get(id);};
 Object.assign(c,{lastFeedMarkup:null,catalog:{videos:c.videos,performers:[{id:'ms',name:'Missioned Souls'}]},groupFor:()=>'',num:String,prettyDate:String,watchFor:()=>({status:'unwatched'}),watchSelect:()=>'',watchStatusMarkup:()=>'',bindHiddenReactors:()=>{}});
 vm.runInContext(source.slice(source.indexOf('function officialFeedCard('),source.indexOf('performerVideos=function()')),c);
 vm.runInContext(source.slice(source.indexOf('function metadata('),source.indexOf('function groupFor(')),c);
 vm.runInContext(source.slice(source.indexOf('renderVideos=function()'),source.indexOf('function watchStatusMarkup(')),c);
 for(const layout of ['cards','compact','table']){
  c.prefs.layout=layout;c.renderVideos();const html=elements.get('videoGrid').innerHTML;
  assert.match(html,/Following this reactor/);assert.match(html,/Following this song: Hysteria/);
  let writes=0,markup=html;const grid=elements.get('videoGrid');
  Object.defineProperty(grid,'innerHTML',{configurable:true,get:()=>markup,set:value=>{writes++;markup=value;}});
  c.renderVideos();assert.equal(writes,0,'unchanged refresh must preserve existing card nodes');
  c.feedMode='all';c.renderVideos();assert.doesNotMatch(elements.get('videoGrid').innerHTML,/following-match/);c.feedMode='following';
 }
});
