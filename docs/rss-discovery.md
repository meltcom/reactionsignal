# RSS discovery fallback and timing

Each 15-minute invocation polls up to 40 eligible channel feeds, four concurrently, within a 12-second polling budget. Channels rotate oldest checks first; a successful check becomes due after 30 minutes. With a larger catalog, rotation takes longer than 30 minutes. Failed feeds retry after an hour. Feed checks use no YouTube Data API requests, while candidate verification still uses batched videos.list calls. Normal upload checks and push subscriptions remain enabled.

RSS screens titles for performer aliases and queues missing titles conservatively. Channel IDs and response size are validated; redirects and XML entity declarations are rejected. Candidates enter the existing verification queue. Repeat feed polling cannot reset retry state or reopen completed jobs. Feed polling does not mark an API upload scan complete.

The discovery status panel reports publication-to-discovery samples by source over 24 hours, including search and RSS. Historical sources are shown separately and excluded from the combined new-upload average. That combined average excludes negative delays and delays over seven days.

New receipt records preserve each video/source's first receipt and first completed processing time. Publication-to-receipt averages omit negative delays such as advance premieres. Processing means metadata processing completed, not that a reaction was approved. The current stored publication date is used for receipt timing, so later premiere corrections can change that comparison. Existing discovery observations retain their original publication snapshot. These timestamps cannot reconstruct receipt history from before deployment.

Deploy through the existing npm run deploy route, which applies migration 0032 before uploading the Worker. No new secrets or bindings are required. After deployment, check RSS coverage and errors, then compare source-specific delays after enough new uploads have arrived.
