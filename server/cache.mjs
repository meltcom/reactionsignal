// Only shared, non-personal projections belong here. Scope by database binding.
const stores=new WeakMap();
export async function sharedCache(db,key,ttl,load){
 let store=stores.get(db);if(!store){store=new Map();stores.set(db,store);}
 for(const [name,entry] of store)if(entry.until<=Date.now())store.delete(name);
 const old=store.get(key);if(old&&old.until>Date.now())return old.promise;
 if(store.size>=32)store.delete(store.keys().next().value);
 const entry={until:Date.now()+ttl,promise:Promise.resolve().then(load)};store.set(key,entry);
 try{return await entry.promise;}catch(error){if(store.get(key)===entry)store.delete(key);throw error;}
}
