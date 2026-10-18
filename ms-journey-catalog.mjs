// Publication years always follow the video's date, never its title or playlist date.
export function videoYear(video){
 const time=Date.parse(video.publishedAt||'');
 return Number.isFinite(time)?String(new Date(time).getUTCFullYear()):null;
}
export function yearCatalog(videos,definitions){
 const oldYears=new Set(definitions.filter(c=>/^\d{4}$/.test(c.name)).map(c=>c.id));
 const years=[...new Set(videos.map(videoYear).filter(Boolean))].sort().reverse();
 const yearDefs=years.map(year=>({id:definitions.find(c=>c.name===year)?.id||'year:'+year,name:year,kind:'year',archived:false}));
 return {categoryDefinitions:[...definitions.filter(c=>!oldYears.has(c.id)),...yearDefs],videos:videos.map(v=>{
  const year=videoYear(v),id=yearDefs.find(c=>c.name===year)?.id;
  return {...v,tags:[...(v.tags||[]).filter(t=>!oldYears.has(t)&&!t.startsWith('year:')),...(id?[id]:[])]};
 })};
}
// Deliberate equivalences only. Broad Christian/vlog/studio collections stay distinct.
export const playlistReplacements={
 'MS Live @ Handuraw':['Handuraw gigs'],
 'MS LIVE':['Live Concerts'],
 'SINULOG 2026 @ J-COB\'S':['Jcobs gigs'],
 'Missioned Souls - OPM covers':['OPM'],
 'PORCH JAMMING':['Porch performances'],
 'Christmas Songs Playlist':['Christmas videos'],
 'MISSIONED SKA covers':['SKA'],
 'SHORTS shorts shorts':['Shorts']
};
export function playlistCatalog(videos,definitions,playlists){
 const replacements=new Map(),playlistDefs=[];
 for(const p of playlists){
  const id='playlist:'+p.id;
  for(const c of definitions)if(c.id!==id&&([...playlistReplacements[p.name]||[],p.name].some(name=>name.toLowerCase()===c.name.toLowerCase())))replacements.set(c.id,id);
  playlistDefs.push({id,name:p.name,kind:'playlist',playlistId:p.id,url:'https://www.youtube.com/playlist?list='+p.id,archived:false});
 }
 const membership=new Map();
 for(const p of playlists)for(const v of p.videos){const tags=membership.get(v.id)||[];tags.push('playlist:'+p.id);membership.set(v.id,tags);}
 const ids=new Set(playlistDefs.map(c=>c.id));
 return {categoryDefinitions:[...definitions.filter(c=>!ids.has(c.id)).map(c=>replacements.has(c.id)?{...c,archived:true,replacedBy:replacements.get(c.id)}:c),...playlistDefs],videos:videos.map(v=>({...v,tags:[...new Set([...(v.tags||[]).filter(t=>!t.startsWith('playlist:')),...membership.get(v.youtubeId)||[]])]}))};
}
