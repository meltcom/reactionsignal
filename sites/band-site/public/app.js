const byId = id => document.getElementById(id);
const state = {entries:[],search:'',reactor:'',sort:'newest'};
const clean = value => String(value ?? '').trim();

function text(tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = clean(content);
  if(className) element.className = className;
  return element;
}
function buildCard(entry) {
  const card = text('article','','card');
  const link = document.createElement('a');
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Watch '+entry.title+' on YouTube (opens in a new tab)');
  const thumb = text('div','','thumb');
  const image = document.createElement('img');
  image.src = entry.thumbnail;
  image.alt = 'YouTube thumbnail for '+entry.title;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  thumb.append(image, text('span','▶','play'));
  const body = text('div','','card-body');
  body.append(text('span',entry.song,'song'),text('h3',entry.title));
  const meta = text('div','','meta');
  meta.append(text('span',entry.reactor),text('time',entry.publishedAt));
  body.append(meta);
  link.append(thumb,body);
  card.append(link);
  return card;
}
function render() {
  const query = clean(state.search).toLocaleLowerCase();
  const matches = state.entries.filter(x =>
    (!state.reactor || x.reactor===state.reactor)
    && (!query || [x.title,x.reactor,x.song].some(value=>clean(value).toLocaleLowerCase().includes(query)))
  );
  matches.sort((a,b)=>state.sort==='title'
    ? a.title.localeCompare(b.title)
    : state.sort==='oldest'
      ? a.publishedAt.localeCompare(b.publishedAt)
      : b.publishedAt.localeCompare(a.publishedAt));
  const results=byId('results');
  results.replaceChildren(...matches.map(buildCard));
  byId('count').textContent='('+matches.length+')';
  byId('message').textContent=matches.length ? '' : 'No matching reactions. Try another song or creator.';
}
async function load() {
  try {
    const responses=await Promise.all([fetch('/api/config'),fetch('/api/catalog')]);
    if(responses.some(r=>!r.ok))throw Error('Site information is not available.');
    const [config,catalog]=await Promise.all(responses.map(r=>r.json()));
    if(config.id!==catalog.site || !Array.isArray(catalog.entries))throw Error('Catalog mismatch.');
    state.entries=catalog.entries.filter(x=>/^[\w-]{11}$/.test(x.id)
      && x.url==='https://www.youtube.com/watch?v='+x.id
      && x.thumbnail==='https://i.ytimg.com/vi/'+x.id+'/hqdefault.jpg');
    byId('tagline').textContent=config.tagline;
    byId('officialChannel').href=config.officialYouTube;
    byId('youtubeSearch').href=config.youtubeSearch;
    const names=[...new Set(state.entries.map(e=>e.reactor))].sort();
    const reactorSelect=byId('reactor');
    for(const name of names) {
      const option=document.createElement('option');
      option.value=name;
      option.textContent=name;
      reactorSelect.append(option);
    }
    render();
  }catch(error){
    byId('message').textContent='The reaction catalog is temporarily unavailable. Please try again later.';
    console.error('Catalog failed to load',error);
  }
}
byId('query').addEventListener('input',event=>{state.search=event.target.value;render();});
byId('reactor').addEventListener('change',event=>{state.reactor=event.target.value;render();});
byId('sort').addEventListener('change',event=>{state.sort=event.target.value;render();});
load();
