import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticate} from '../server/auth.mjs';
test('Cloudflare targets the supplied database, schedules discovery and permits confirmed members',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.d1_databases[0].database_id,'331e0607-6cf1-4e5c-864e-8b2179e750df');
 assert.equal(config.d1_databases[0].binding,'DB');assert.deepEqual(config.triggers.crons,['*/15 * * * *']);
 assert.equal(config.vars.MEMBER_EMAIL_ALLOWLIST,'');
 assert.ok(config.vars.COMMUNITY_MODERATOR_EMAILS.split(',').map(x=>x.trim()).includes('meltcom@gmail.com'));
});
test('invitation gating limits verified members while retaining independent moderator checks',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-key',MEMBER_EMAIL_ALLOWLIST:'owner@example.com',COMMUNITY_MODERATOR_EMAILS:'owner@example.com'};
 const request=new Request('https://site.test/data.json',{headers:{Authorization:'Bearer fixture.token'}});
 const profile=email=>async()=>Response.json({id:'member',email,email_confirmed_at:'2026-09-30T00:00:00Z'});
 assert.equal((await authenticate(request,env,profile('stranger@example.com'))).error.status,403);
 const owner=await authenticate(request,env,profile('owner@example.com'));assert.equal(owner.user.moderator,true);
 const open=await authenticate(request,{...env,MEMBER_EMAIL_ALLOWLIST:''},profile('fan@example.com'));assert.equal(open.user.moderator,false);
});
