import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
process.env.TZ='America/Los_Angeles';
const source=readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function isNewToday('),source.indexOf('function followed(')),context);
const now=new Date('2026-10-09T13:16:22Z');
const matches=video=>context.isNewToday(video,now);
test('premiere discovered Oct 6 appears when published Oct 9',()=>{
 assert.equal(matches({discoveredAt:'2026-10-06T18:00:27.969Z',publishedAt:'2026-10-09T10:00:06Z'}),true);
});
test('older upload newly discovered today remains included',()=>{
 assert.equal(matches({discoveredAt:'2026-10-09T12:00:00Z',publishedAt:'2025-01-01T12:00:00Z'}),true);
});
test('uses local date and excludes future premieres and invalid dates',()=>{
 assert.equal(matches({discoveredAt:'2026-10-06T18:00:00Z',publishedAt:'2026-10-09T06:59:59Z'}),false);
 assert.equal(matches({publishedAt:'2026-10-09T07:00:00Z'}),true);
 assert.equal(matches({discoveredAt:'2026-10-06T18:00:00Z',publishedAt:'2026-10-09T20:00:00Z'}),false);
 assert.equal(matches({discoveredAt:null,publishedAt:'invalid'}),false);
 assert.equal(matches({}),false);
});
