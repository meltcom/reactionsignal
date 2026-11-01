import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Explicit production inputs; never fingerprint credentials, tmp/, or other projects.
export async function sourceFingerprint(root){
 const files=[];
 async function walk(directory){
  for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
   const path=directory?directory+'/'+entry.name:entry.name;
   if(entry.isDirectory()){if(directory||['server','scripts','images','member-guides','tests','drizzle','docs','.github'].includes(entry.name))await walk(path);}
   else if(directory||(/\.(?:html|css|js|mjs|json|jsonc|webmanifest|md)$/.test(entry.name)||['.gitignore','.gitattributes'].includes(entry.name)))files.push(path);
  }
 }
 await walk('');
 const hash=createHash('sha256');
 for(const path of files.sort())hash.update(path+'\0').update(await readFile(join(root,path))).update('\0');
 return hash.digest('hex');
}
export function assertSameDeployment(before,after){
 const normalize=value=>JSON.stringify(value.map(v=>({version_id:v.version_id,percentage:v.percentage})).sort((a,b)=>a.version_id.localeCompare(b.version_id)));
 if(!before.length||normalize(before)!==normalize(after))throw Error('Production changed during release preparation. Stop and review the new active version.');
}
export function assertRelease(expected,actual){
 if(actual?.schema!==1||actual.sourceHash!==expected.sourceHash||actual.builtAt!==expected.builtAt)throw Error('Live release identity does not match this build. Deployment verification failed.');
}
export async function artifactFingerprint(root,readDirectory=readdir){
 const files=[];
 async function walk(directory){
  for(const entry of await readDirectory(join(root,directory),{withFileTypes:true})){
   const path=directory?directory+'/'+entry.name:entry.name;
   if(entry.isDirectory())await walk(path);
   // OneDrive placeholders can change Dirent type during hydration. Seal every
   // non-directory entry's bytes; readFile fails closed on unreadable entries.
   else if(path!=='build-integrity.json')files.push(path);
  }
 }
 await walk('');const hash=createHash('sha256');
 for(const path of files.sort())hash.update(path+'\0').update(await readFile(join(root,path))).update('\0');
 return hash.digest('hex');
}

export function assertReleaseCheckout({head,remoteMain,branch,dirty,allowDirty=false}){
 if(!/^[0-9a-f]{40}$/.test(head||'')||head!==remoteMain)throw Error('Release must use the current GitHub main commit. Reconcile and merge the reviewed source first.');
 if(branch&&branch!=='main')throw Error('Production releases must use main or a detached checkout of its approved commit.');
 if(dirty&&!allowDirty)throw Error('Uncommitted changes found. Obtain approval for the exact scope before --allow-dirty.');
}
