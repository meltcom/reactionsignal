// A band can be added without duplicating the Worker or client-side application.
// The initial pilot is deliberately read-only. Membership and paid features are not enabled.
export const sites = Object.freeze({
  'the-warning': {
    id: 'the-warning',
    name: 'The Warning',
    tagline: 'Explore reactions and discover the people listening.',
    officialSite: 'https://www.thewarningband.com/',
    officialYouTube: 'https://www.youtube.com/@TheWarning',
    youtubeSearch: 'https://www.youtube.com/results?search_query=The+Warning+reaction',
    accent: '#ec5f65',
    pilot: true,
    entries: [
      {id: 'QpNtUo4U61Y', title: "The Warning – Everything's Falling | Reaction", reactor: 'RJS_Reactions', song: "Everything's Falling", publishedAt: '2026-08-29'},
      {id: 'r6n2Ik3aNMM', title: "My first The Warning album! Everything's Falling – Full Album Reaction", reactor: 'ih8grace2', song: "Everything's Falling (album)", publishedAt: '2026-08-29'},
      {id: 'kcY6wNXfmno', title: 'The Warning – Kerosene (Official Video) | Reaction', reactor: 'Highly Combustible Reacts', song: 'Kerosene', publishedAt: '2026-08-18'},
      {id: 'ACyCAsBSpXg', title: 'BAND-MAID with The Warning / SHOW THEM | Reaction', reactor: 'MommaOG', song: 'SHOW THEM', publishedAt: '2024-09-06'}
    ]
  }
});
