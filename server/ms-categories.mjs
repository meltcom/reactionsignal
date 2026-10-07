import {categories} from '../missioned-souls-core.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function categoryRegistry(db){const row=await db.prepare('SELECT value FROM state WHERE key=?').bind('ms-categories').first();return row?JSON.parse(row.value):{revision:0,items:categories.map(id=>({id,name:id,archived:false}))};}
export async function manageCategories(db,b){
 const old=await categoryRegistry(db);
 if(b.revision!==old.revision)return json({error:'Categories changed. Reload and try again.'},409);
 const items=old.items.map(c=>({...c})),index=items.findIndex(c=>c.id===b.id);
 if(['add','rename'].includes(b.operation)){
  if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>60||/[\u0000-\u001f\u007f]/.test(b.name))return json({error:'Use a category name of 1–60 characters.'},400);
  const name=b.name.trim();
  if(['all videos','facebook only'].includes(name.toLowerCase())||items.some(c=>(b.operation==='add'||c.id!==b.id)&&c.name.toLowerCase()===name.toLowerCase()))return json({error:'That category name is already in use or reserved.'},400);
  if(b.operation==='add'){if(items.length>=100)return json({error:'The catalog supports up to 100 categories.'},400);items.push({id:'custom:'+crypto.randomUUID(),name,archived:false});}
  else{if(index<0)return json({error:'Category not found.'},404);if(b.id==='Shorts')return json({error:'Shorts is a fixed video format category.'},400);items[index].name=name;}
 }else if(b.operation==='archive'){
  if(index<0)return json({error:'Category not found.'},404);
  if(b.id==='Shorts')return json({error:'Shorts is a fixed video format category.'},400);
  if(typeof b.archived!=='boolean')return json({error:'Choose archive or restore.'},400);
  items[index].archived=b.archived;
 }else if(b.operation==='move'){
  if(index<0||![-1,1].includes(b.direction))return json({error:'Choose a category and move direction.'},400);
  const target=index+b.direction;if(target>=0&&target<items.length)[items[index],items[target]]=[items[target],items[index]];
 }else return json({error:'Unknown category action.'},400);
 await db.prepare('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)').bind('ms-categories',JSON.stringify(old)).run();
 const result=await db.prepare('UPDATE state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({revision:old.revision+1,items}),'ms-categories',JSON.stringify(old)).run();
 if(!result.meta?.changes)return json({error:'Categories changed. Reload and try again.'},409);
 return json({ok:true,message:'Categories updated.'});
}
