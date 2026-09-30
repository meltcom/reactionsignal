import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authenticate,authConfig} from '../server/auth.mjs';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',COMMUNITY_MODERATOR_EMAILS:'lead@example.com,other@example.com'};
const request=(headers={})=>new Request('https://pilot.test/api/auth/me',{headers});
test('platform headers and caller-declared roles never establish membership',async()=>{
  const forged=request({'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'lead@example.com','X-Moderator':'true'});
  assert.equal((await authenticate(forged,env,()=>{throw Error('Should not fetch');})).error.status,401);
});
test('only a verified Supabase user with confirmed email gets a server-assigned role',async()=>{
  const signed=request({Authorization:'Bearer valid.token'});
  const lookup=async(url,options)=>{
    assert.equal(url,'https://example.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization,'Bearer valid.token');
    return Response.json({id:'4b502a2c-3e25-41cd-847d-043542993f5c',email:'Lead@Example.com',email_confirmed_at:'2026-09-29T00:00:00Z'});
  };
  assert.deepEqual((await authenticate(signed,env,lookup)).user,{id:'supabase:4b502a2c-3e25-41cd-847d-043542993f5c',email:'lead@example.com',moderator:true});
  const member=await authenticate(signed,env,async()=>Response.json({id:'another',email:'fan@example.com',email_confirmed_at:'2026-09-29T00:00:00Z'}));
  assert.equal(member.user.moderator,false);
  const unconfirmed=await authenticate(signed,env,async()=>Response.json({id:'another',email:'lead@example.com'}));
  assert.equal(unconfirmed.error.status,403);
  assert.equal((await authenticate(signed,env,async()=>new Response('',{status:401}))).error.status,401);
});
test('missing or invalid auth configuration fails closed',async()=>{
  assert.equal(authConfig({...env,SUPABASE_URL:'http://example.supabase.co'}),null);
  assert.equal((await authenticate(request({Authorization:'Bearer token'}),{})).error.status,503);
});
