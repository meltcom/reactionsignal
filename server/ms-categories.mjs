import snapshot from '../ms-playlist-catalog.json' with {type:'json'};
import {playlistCatalog} from '../ms-journey-catalog.mjs';
import {categories} from '../missioned-souls-core.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function categoryRegistry(db){const row=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-categories').first();const registry=row?JSON.parse(row.value):{revision:0,items:[]};const items=[...categories.filter(id=>!registry.items.some(c=>c.id===id)).map(id=>({id,name:id,archived:false})),...registry.items];const sync=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-playlists').first();const playlists=sync?JSON.parse(sync.value):snapshot;return {...registry,items:playlistCatalog([],items,playlists.playlists).categoryDefinitions};}
export async function manageCategories(db,b){
 const row=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-categories').first(),oldValue=row?.value||null,stored=row?JSON.parse(row.value):{revision:0,items:[]};const old={...stored,items:[...categories.filter(id=>!stored.items.some(c=>c.id===id)).map(id=>({id,name:id,archived:false})),...stored.items]};
 if(b.revision!==old.revision)return json({error:'Categories changed. Reload and try again.'},409);
 const items=old.items.map(c=>({...c})),index=items.findIndex(c=>c.id===b.id);
 if(['add','rename'].includes(b.operation)){
  if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>60||/[\u0000-\u001f\u007f]/.test(b.name))return json({error:'Use a category name of 1–60 characters.'},400);
  const name=b.name.trim();
  if(['all videos','facebook only'].includes(name.toLowerCase())||items.some(c=>(b.operation==='add'||c.id!==b.id)&&c.name.toLowerCase()===name.toLowerCase()))return json({error:'That category name is already in use or reserved.'},400);
  if(b.operation==='add'){if(items.length>=100)return json({error:'The catalog supports up to 100 categories.'},400);items.push({id:'custom:'+crypto.randomUUID(),name,archived:false});}
  else{if(index<0)return json({error:'Category not found.'},404);if(['Shorts','Community finds'].includes(b.id))return json({error:'This category is fixed.'},400);items[index].name=name;}
 }else if(b.operation==='archive'){
  if(index<0)return json({error:'Category not found.'},404);
  if(['Shorts','Community finds'].includes(b.id))return json({error:'This category is fixed.'},400);
  if(typeof b.archived!=='boolean')return json({error:'Choose archive or restore.'},400);
  items[index].archived=b.archived;
 }else if(b.operation==='move'){
  if(index<0||![-1,1].includes(b.direction))return json({error:'Choose a category and move direction.'},400);
  const target=index+b.direction;if(target>=0&&target<items.length)[items[index],items[target]]=[items[target],items[index]];
 }else return json({error:'Unknown category action.'},400);
 const prior=JSON.stringify(old);
 if(oldValue&&oldValue!==prior){const sync=await db.prepare('UPDATE state SET value=? WHERE key=? AND value=?').bind(prior,'ms-categories',oldValue).run();if(!sync.meta?.changes)return json({error:'Categories changed. Reload and try again.'},409);}
 else if(!oldValue)await db.prepare('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)').bind('ms-categories',prior).run();
 const result=await db.prepare('UPDATE state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({revision:old.revision+1,items}),'ms-categories',prior).run();
 if(!result.meta?.changes)return json({error:'Categories changed. Reload and try again.'},409);
 return json({ok:true,message:'Categories updated.'});
}
