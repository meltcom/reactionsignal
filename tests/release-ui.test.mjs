import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assets} from '../dist/server/assets.mjs';
import worker from '../dist/server/index.js';
import {performerQueries} from '../server/discovery.mjs';
import {readFileSync} from 'node:fs';
import {configured} from '../server/youtube-connection.mjs';

test('production deployment retains the required public YouTube OAuth configuration',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.vars.YOUTUBE_OAUTH_ORIGIN,'https://reactionjourney.com');
 assert.equal(configured({...config.vars,GOOGLE_YOUTUBE_CLIENT_SECRET:'test-only-secret',YOUTUBE_TOKEN_ENCRYPTION_KEY:'x'.repeat(43)}),true);
 assert.equal(config.vars.GOOGLE_YOUTUBE_CLIENT_SECRET,undefined);
 assert.equal(config.vars.YOUTUBE_TOKEN_ENCRYPTION_KEY,undefined);
});

test('release packages the approved member UI and keeps PR44 search rotation',()=>{
 const html=assets['/index.html'].body, dashboard=assets['/dashboard.js'].body, ms=assets['/missioned-souls.js'].body;
 for(const path of ['/signin.css','/about.html','/member-guides.js','/images/sunset-coastal-highway-badge.png','/private-guides/reaction-journey-overview.pdf','/private-guides/reaction-journey-app-guide.pdf'])assert.ok(assets[path],`Missing release asset: ${path}`);
 assert.ok(html.includes('href="/signin.css"')&&html.includes('member-guides.js')&&html.includes('id="help-downloads"'));
 const welcome=html.slice(html.indexOf('<main id="welcome"'));
 assert.ok(welcome.includes('id="googleSignIn"')&&welcome.includes('id="emailSignIn"'));
 assert.ok(!welcome.includes('welcome-benefits'));
 for(const feature of ['includeShorts','feed-search-filters','function feedVideos()','const firstReaction=new Map()','const latestByReactor=new Map()','choice.onchange=','followAllReactors'])assert.ok(dashboard.includes(feature),`Missing dashboard feature: ${feature}`);
 for(const feature of ['ms-year','ms-playlists-refresh','ms-search-toggle'])assert.ok(ms.includes(feature),`Missing MS Journey feature: ${feature}`);
 assert.ok(assets['/about.html'].body.includes('public-youtube'));
 const queries=performerQueries({name:'Missioned Souls',aliases:'["MissionedSoul"]'},['DECODE']);
 assert.equal(queries.length,20);assert.equal(queries.filter(q=>q==='"Missioned Souls"').length,12);assert.equal(queries.filter(q=>q==='"Missioned Souls" reaction').length,6);
});

test('packaged guide routes require membership and do not expose PDF assets publicly',async()=>{
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
 for(const name of ['overview','app-guide']){
  const response=await worker.fetch(new Request('https://local.test/api/member-guides/'+name),env);
  assert.equal(response.status,401,'Guide route must exist and require authentication');
 }
 for(const name of ['reaction-journey-overview.pdf','reaction-journey-app-guide.pdf']){
  const response=await worker.fetch(new Request('https://local.test/private-guides/'+name),env);
  assert.equal(response.status,404,'Raw guide asset must not be public');
 }
});

test('release packages MS Journey visibility controls with matching help and existing browsing',()=>{
 const html=assets['/index.html'].body,ms=assets['/missioned-souls.js'].body;
 for(const id of ['ms-visibility-control','ms-visibility','ms-year','ms-playlists-refresh','ms-search-toggle','ms-stats-import','ms-stats-template','ms-thumbnail-preview','ms-facebook-fetch','ms-fetch-facebook','ms-manual-facebook','ms-fetch-facebook-status','ms-facebook-help'])assert.ok(html.includes('id="'+id+'"'),id);
 for(const action of ['Hide from members','Remove from MS Journey','Restore to MS Journey'])assert.ok(ms.includes(action),action);
 for(const feature of ['thumbnailData','statisticsRows','Recent measurements','statsPrecision','durationSeconds','fetch-facebook-metadata'])assert.ok(ms.includes(feature),feature);
 assert.ok(html.includes('Get Facebook details &amp; thumbnail'));
 assert.ok(ms.includes('Continue with manual details')&&ms.includes('permanent storage'));
 for(const instruction of ['Copy link','published date','00:26','Win + Shift + S','Thumbnail URL','opens publicly while signed out'])assert.ok(html.includes(instruction),instruction);
 assert.ok(html.includes('Visibility decisions survive official-channel refreshes and repeated imports.'));
});

test('release retains compact cards, app navigation and optimized branding',()=>{
 assert.ok(assets['/journey-interface.js']?.body.length>1000,'shared journey interface bundle');
 assert.ok(assets['/journey-interface.css']?.body.includes('rgba(255,255,255,.88)'),'original coastal translucence');
 assert.ok(assets['/index.html'].body.includes('src="/journey-interface.js"'),'shared interface loaded');
 const dashboard=assets['/dashboard.js'].body,css=assets['/dashboard.css'].body,mobile=assets['/mobile-app.js'].body;
 for(const feature of ['card-watch-status','card-watch-link','video-play-link','videoDiscussionActionsMarkup','lastFeedMarkup','dataIndexes'])assert.ok(dashboard.includes(feature),feature);
 assert.ok(css.includes('.card-heading')&&css.includes('.card-watch-link'));
 assert.ok(mobile.includes('reaction-journey-interface-')&&mobile.includes('Customize feed'));
 for(const name of ['reaction-journey-logo-small','reaction-journey-app-logo-small','ms-journey-logo-small','sunset-coastal-highway-badge-small']){
  const image=assets['/images/'+name+'.webp'];assert.ok(image,name);
  const bytes=Buffer.from(image.base64,'base64');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<100000,name+' must remain optimized');
 }
 assert.ok(assets['/index.html'].body.includes('images/reaction-journey-logo-small.webp'));
});

test('release describes dedicated YouTube membership while keeping import matching separate from active follows',()=>{
 const html=assets['/index.html'].body,imports=assets['/youtube-subscriptions.js'].body,dashboard=assets['/dashboard.js'].body;
 assert.ok(html.includes('separate system-managed Following group named YouTube imports'));
 assert.ok(imports.includes('youtubeImports')&&imports.includes('dedicated YouTube imports group'));
 assert.ok(dashboard.includes("active?.kind==='youtube'"));
});
