import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assets} from '../dist/server/assets.mjs';
import worker from '../dist/server/index.js';
import {performerQueries} from '../server/discovery.mjs';

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
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture'};
 for(const name of ['overview','app-guide']){
  const response=await worker.fetch(new Request('https://local.test/api/member-guides/'+name),env);
  assert.equal(response.status,401,'Guide route must exist and require authentication');
 }
 for(const name of ['reaction-journey-overview.pdf','reaction-journey-app-guide.pdf']){
  const response=await worker.fetch(new Request('https://local.test/private-guides/'+name),env);
  assert.equal(response.status,404,'Raw guide asset must not be public');
 }
});
