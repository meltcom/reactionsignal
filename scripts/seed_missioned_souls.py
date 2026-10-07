"""Build a portable catalog from saved JSON offline, or the official YouTube API online.
No third-party Python packages required. Run --help for examples.
"""
import argparse, datetime as dt, json, os, re, sys, urllib.request, urllib.parse
from pathlib import Path

RULES = {
 'Live Concerts':r'concert|live in|live at|tour performance', 'Home Studio':r'studio',
 'All Vlogs':r'vlog|unboxing|birthday|celebrating|in dumaguete',
 'Location Vlogs':r'vlog.*(?:in |trip|travel)|in dumaguete',
 'Equipment Vlogs':r'unboxing|equipment|gear|pedal|rig|play button',
 'Birthday Vlogs':r'birthday|celebrating.*today', 'Solo performances':r'solo',
 'Shorts':r'#shorts|\bshorts\b', 'Songs':r'cover| by |official music|official video',
 'Handuraw gigs':r'handuraw', 'Jcobs gigs':r'jcobs|j.?cob.?s',
 'Living Room performances':r'living room', 'Porch performances':r'porch',
 'Christmas videos':r'christmas|silent night|jingle bells',
 'Christian videos':r'christian|worship|praise|gospel', 'OPM':r'\bopm\b|original pilipino'}

def normalize(v, recorded_at=None):
    snippet=v.get('snippet',{})
    title=v.get('title') or snippet.get('title')
    vid=v.get('id') or v.get('youtubeId')
    if isinstance(vid,dict): vid=vid.get('videoId')
    url=v.get('url') or v.get('webpage_url') or (f'https://www.youtube.com/watch?v={vid}' if vid else None)
    if url and re.fullmatch(r'[\w-]{11}',url): url=f'https://www.youtube.com/watch?v={url}'
    if not title or not url: raise ValueError('Every input record needs a video title and URL or YouTube ID.')
    published=v.get('publishedAt') or snippet.get('publishedAt') or v.get('timestamp')
    if isinstance(published,(int,float)): published=dt.datetime.fromtimestamp(published,dt.timezone.utc).isoformat()
    if not published and v.get('upload_date'): published=dt.datetime.strptime(v['upload_date'],'%Y%m%d').replace(tzinfo=dt.timezone.utc).isoformat()
    stats=v.get('statistics',{})
    result={**v,'title':title,'url':url,'publishedAt':published,
            'tags':v.get('tags') if isinstance(v.get('tags'),list) and all(t in RULES for t in v['tags']) else [t for t,p in RULES.items() if re.search(p,title,re.I)],
            'reviewed':bool(v.get('reviewed',False)), 'sourceNote':v.get('sourceNote','Imported metadata; suggested categories need review.')}
    for key,alias,api_key in [('views','view_count','viewCount'),('likes','like_count','likeCount'),('comments','comment_count','commentCount')]:
        value=v.get(key,v.get(alias,stats.get(api_key)))
        result[key]=int(value) if value is not None else None
        if result[key] is not None and result[key]<0: raise ValueError('Statistics cannot be negative.')
    result['statsAt']=v.get('statsAt') or (recorded_at if any(result[k] is not None for k in ['views','likes','comments']) else None)
    return {k:result.get(k) for k in ['title','url','publishedAt','statsAt','views','likes','comments','tags','reviewed','youtubeEquivalent','available','sourceNote'] if result.get(k) is not None}

def youtube():
    key=os.environ.get('YOUTUBE_API_KEY')
    if not key: raise ValueError('Set YOUTUBE_API_KEY in the environment for --youtube. Offline --input does not require it.')
    def api(endpoint,**params):
        request=urllib.request.Request('https://www.googleapis.com/youtube/v3/'+endpoint+'?'+urllib.parse.urlencode({**params,'key':key}))
        try:
            with urllib.request.urlopen(request,timeout=30) as response: return json.load(response)
        except Exception: raise ValueError('YouTube request failed. Check API access, network, and quota.') from None
    channel=api('channels',part='contentDetails',forHandle='@MissionedSouls')['items'][0]
    uploads=channel['contentDetails']['relatedPlaylists']['uploads'];token=None;records=[]
    while True:
        params={'part':'contentDetails','playlistId':uploads,'maxResults':50}
        if token: params['pageToken']=token
        page=api('playlistItems',**params);ids=[x['contentDetails']['videoId'] for x in page['items']]
        if ids: records.extend(v for v in api('videos',part='snippet,statistics',id=','.join(ids))['items'] if v['snippet']['channelId']==channel['id'])
        token=page.get('nextPageToken')
        if not token: break
    return records

def main():
    p=argparse.ArgumentParser(description=__doc__,epilog='Offline: --input saved-videos.json --output catalog.json. Online: --youtube --output catalog.json. Import output using Catalog updates in the preview.')
    p.add_argument('--input',type=Path,help='Catalog JSON, saved YouTube videos.list JSON, yt-dlp JSON/JSONL, or a JSON array. No network calls.')
    p.add_argument('--youtube',action='store_true',help='Fetch every public official-channel upload and current statistics (requires internet and YOUTUBE_API_KEY).')
    p.add_argument('--recorded-at',help='ISO time when statistics in an offline source were collected. Omit if unknown.')
    p.add_argument('--output',type=Path,default=Path('missioned-souls-catalog.json'))
    a=p.parse_args()
    if bool(a.input)==bool(a.youtube): p.error('Choose exactly one of --input or --youtube.')
    if a.recorded_at: dt.datetime.fromisoformat(a.recorded_at.replace('Z','+00:00'))
    if a.youtube:
        records=youtube();recorded=dt.datetime.now(dt.timezone.utc).isoformat()
    else:
        raw=a.input.read_text(encoding='utf-8-sig')
        try: source=json.loads(raw)
        except json.JSONDecodeError: source=[json.loads(line) for line in raw.splitlines() if line.strip()]
        records=source if isinstance(source,list) else source.get('videos',source.get('items',source.get('entries',[source])))
        recorded=a.recorded_at
    videos={}
    for v in records:
        if v is None: continue
        row=normalize(v,recorded);videos[row['url']]=row
    output={'updatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'coverage':f'{len(videos)} imported records. Category suggestions need review. '+('Full public official YouTube uploads pass; Facebook and other sources require separate import.' if a.youtube else 'Offline import; completeness depends on the supplied file.'),'videos':list(videos.values())}
    a.output.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    # Split large channels into UI-compatible batches without dropping any records.
    if len(videos)>1000:
        for i in range(0,len(output['videos']),1000):
            batch=a.output.with_name(a.output.stem+f'-part-{i//1000+1}.json');batch.write_text(json.dumps({'videos':output['videos'][i:i+1000]},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Wrote {len(videos)} videos to {a.output}. Import JSON through Catalog updates; review suggested categories.')

if __name__=='__main__':
    try: main()
    except (ValueError,KeyError,IndexError,OSError) as error: print(str(error),file=sys.stderr);sys.exit(1)
