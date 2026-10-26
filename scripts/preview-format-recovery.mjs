import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {previewFormatRecovery} from '../server/format-recovery-preview.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function previewArguments(args,platform=process.platform){
 const options={};
 for(let i=0;i<args.length;i+=2){if(!['--input','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])throw Error('Use --input snapshot.json and optional --output output/preview.json only. There is no apply mode.');options[args[i]]=args[i+1];}
 if(!options['--input'])throw Error('An explicit --input pilot snapshot is required.');
 const input=resolve(root,options['--input']),output=resolve(root,options['--output']||'output/format-recovery-fresh-preview.json');
 const samePath=platform==='win32'?input.toLowerCase()===output.toLowerCase():input===output;
 if(!output.startsWith(resolve(root,'output')+sep)||!output.endsWith('.json')||samePath)throw Error('Write the preview to a separate JSON file inside project output/.');
 return {input,output};
}
export async function writePreviewReport(output,report){
 await mkdir(dirname(output),{recursive:true});
 // Exclusive creation protects existing files, case aliases and links even if
 // another process creates the destination after argument validation.
 try{await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});}
 catch(error){if(error.code==='EEXIST')throw Error('Preview output already exists. Choose a new output JSON file; no existing file was replaced.');throw error;}
}
async function localKey(){
 if(process.env.YOUTUBE_API_KEY)return process.env.YOUTUBE_API_KEY;
 let text;try{text=await readFile(resolve(root,'.dev.vars'),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw Error('Could not read the local secrets file.');}
 const match=text.match(/^\s*YOUTUBE_API_KEY\s*=\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s#]+))\s*(?:#.*)?$/m);
 return match&&(match[1]||match[2]||match[3]);
}
async function main(){
 if(process.argv.slice(2).length===1&&process.argv[2]==='--help'){console.log('Preview only: node scripts/preview-format-recovery.mjs --input output/pilot.json [--output output/preview.json]\nSet YOUTUBE_API_KEY in the local environment or ignored project .dev.vars. The input is an explicitly selected array of 1–12 D1 video snapshot rows. No database connection or apply mode.');return;}
 const {input,output}=previewArguments(process.argv.slice(2));
 let rows;try{rows=JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('Could not read a valid JSON pilot snapshot.');}
 const report=await previewFormatRecovery(rows,{apiKey:await localKey()});
 await writePreviewReport(output,report);
 console.log(JSON.stringify({mode:report.mode,requested:report.requested,proposed:report.proposed,unresolved:report.unresolved,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
