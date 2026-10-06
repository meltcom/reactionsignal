// Convert supported reconciled workbook sheets to a small, public-metadata payload.
export function workbookPayload(sheets,filename){
 const master=sheets.find(s=>s.sheet==='Updated Master');if(!master)throw new Error('This workbook needs an Updated Master sheet.');
 const videoSheets=sheets.filter(s=>/^Video Import \d{4}-\d{2}-\d{2}$/.test(s.sheet)).sort((a,b)=>b.sheet.localeCompare(a.sheet));
 const latest=videoSheets[0];if(!latest)throw new Error('This workbook needs a dated Video Import sheet.');
 function records(sheet,required){const [headers,...rows]=sheet.data;if(!headers||required.some(h=>!headers.includes(h)))throw new Error('Required columns are missing in '+sheet.sheet+'.');return rows.filter(r=>r.some(v=>v!==null&&v!==undefined&&v!=='')).map((r,index)=>Object.assign(Object.fromEntries(headers.map((h,i)=>[h,r[i]??null])),{row:index+2}));}
 const channels=records(master,['Channel ID','Channel Name']).map(r=>({id:r['Channel ID'],name:r['Channel Name']}));
 let omitted=0;const videos=[];
 for(const r of records(latest,['Video ID','Channel ID','Video Title','Classification','Format','Count as Unique','Published UTC'])){
  if(!['TRUE','true',true,1].includes(r['Count as Unique'])||!['CONFIRMED','PROBABLE','PENDING'].includes(r.Classification)){omitted++;continue;}
  const d=r['Published UTC'];let publishedAt=null;if(d!==null){if(!(d instanceof Date)&&typeof d!=='string')throw new Error('Unrecognized date in '+latest.sheet+', row '+r.row);const date=d instanceof Date?d:new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(d)?d:d.replace(' ','T')+'Z');if(!Number.isFinite(date.getTime()))throw new Error('Invalid date in '+latest.sheet+', row '+r.row);publishedAt=date.toISOString();}
  videos.push({id:r['Video ID'],channelId:r['Channel ID'],title:r['Video Title'],publishedAt,confidence:r.Classification,format:r.Format});
 }
 return {filename,sheet:latest.sheet,channels,videos,omitted};
}
