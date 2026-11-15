import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {settings} from '../server/social.mjs';
const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
const code=source.split('function followingName(f)')[1].split(';(()=>{')[0];
const dateHelpers=source.slice(source.indexOf('function firstReactionDatesByReactor()'),source.indexOf('renderReactors=function()',source.indexOf('function firstReactionDatesByReactor()')));
test('following sorts use names, personal/community ranking, song averages and unrated last',()=>{
 const context={catalog:{channels:[{id:'a',name:'Zulu'},{id:'b',name:'Alpha'},{id:'c',name:'Beta'}],videos:[{id:'v1',title:'Hysteria reaction',channelId:'a'},{id:'v2',song:'Hysteria',title:'Reaction',channelId:'b'}]},dashboard:{follows:[],hiddenReactors:[]},scoreMap:new Map([['v1',{average:5}],['v2',{average:3}]]),reactorScore:id=>({a:{average:90},b:{average:60}}[id]),myReactorRating:id=>({a:20,b:80}[id])};
 context.reactorRankValue=id=>Number(context.reactorScore(id)?.average??-1);
 vm.createContext(context);vm.runInContext(dateHelpers+'function followingName(f)'+code,context);
 const rows=['a','b','c'].map(target=>({kind:'reactor',target}));
 assert.equal(context.sortFollowingRows(rows,'name').map(f=>f.target).join(','),'b,c,a');
 assert.equal(context.sortFollowingRows(rows,'ranked').map(f=>f.target).join(','),'a,b,c');
 assert.equal(context.sortFollowingRows(rows,'personal').map(f=>f.target).join(','),'b,a,c');
 assert.equal(context.followingRank({kind:'song',target:'Hysteria'}),80);
 assert.equal(context.followingRank({kind:'song',target:'Unknown'}),null);
 assert.equal(context.sortFollowingGroups([{id:'1',name:'Zulu',follows:rows.slice(0,1)},{id:'2',name:'Alpha',follows:[]}],'ranked')[0].id,'1');
 assert.equal(rows[0].target,'a');
});
test('following sort preferences accept only supported values',()=>{
 assert.equal(settings({followingReactorSort:'oldest'}).followingReactorSort,'oldest');
 assert.equal(settings({followingReactorSort:'personal',followingSongSort:'ranked',followingGroupSort:'name'}).followingReactorSort,'personal');
 assert.throws(()=>settings({followingSongSort:'personal'}));
});

test('first reaction sorts recompute backfilled uploads and keep unknown dates last',()=>{
 const context=vm.createContext({catalog:{videos:[{channelId:'a',performerId:'missioned-souls',publishedAt:'2025-01-01'},{channelId:'b',performerId:'missioned-souls',publishedAt:'2026-01-01'},{channelId:'b',performerId:'other',publishedAt:'2000-01-01'},{channelId:'b',performerId:'missioned-souls',isOfficial:true,publishedAt:'2001-01-01'},{channelId:'unknown',performerId:'missioned-souls',publishedAt:'invalid'}]}});
 vm.runInContext(dateHelpers,context);
 let dates=context.firstReactionDatesByReactor();
 assert.ok(context.compareFirstReaction('a','A','b','B',dates,'newest')>0);
 assert.ok(context.compareFirstReaction('a','A','b','B',dates,'oldest')<0);
 for(const order of ['newest','oldest'])assert.ok(context.compareFirstReaction('unknown','Unknown','a','A',dates,order)>0);
 context.catalog.videos.push({channelId:'b',performerId:'missioned-souls',publishedAt:'2024-01-01'});
 dates=context.firstReactionDatesByReactor();assert.equal(dates.get('b'),Date.parse('2024-01-01'));
 assert.ok(context.compareFirstReaction('a','A','b','B',dates,'newest')<0);
});
