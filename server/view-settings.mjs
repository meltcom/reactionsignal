// Shared validation for account-scoped views. No schema changes are required.
export const viewScope=value=>value==='ms-journey'?'ms-journey':'reactions';
export const normalizedViewName=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
export const protectedViewName=value=>['small','default','large'].includes(normalizedViewName(value));
export const builtinViewId=value=>typeof value==='string'&&value.startsWith('builtin:');
export function builtinViews(scope='reactions'){
 return Object.freeze([['Small','small',4],['Default','medium',3],['Large','large',2]].map(([name,thumbnail,columns])=>Object.freeze({id:`builtin:${viewScope(scope)}:${name.toLowerCase()}`,name,builtin:true,settings:Object.freeze({scope:viewScope(scope),layout:'cards',thumbnail,columns,density:'standard'})})));
}
export function archiveSettings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid MS Journey settings.');
 const out={scope:'ms-journey'};
 const choices={layout:['cards','compact'],thumbnail:['small','medium','large'],density:['compact','standard','spacious'],source:['all','YouTube','Facebook','Other','facebook-only'],format:['all','full','shorts'],sort:['latest','views','likes','comments','growth'],limit:['all','10'],period:['day','week','month'],section:['browse','playlists','collections']};
 for(const [key,allowed] of Object.entries(choices))if(input[key]!==undefined){if(!allowed.includes(input[key]))throw Error('Invalid MS Journey '+key+'.');out[key]=input[key];}
 if(input.columns!==undefined){if(!Number.isInteger(input.columns)||input.columns<1||input.columns>5)throw Error('Choose 1–5 columns.');out.columns=input.columns;}
 for(const key of ['query','category','defaultView'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>200)throw Error('Invalid MS Journey '+key+'.');out[key]=input[key];}
 if(input.year!==undefined){if(typeof input.year!=='string'||!(/^(all|unknown|\d{4})$/).test(input.year))throw Error('Invalid MS Journey year.');out.year=input.year;}
 return out;
}
