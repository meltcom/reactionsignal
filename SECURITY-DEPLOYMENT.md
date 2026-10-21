# Security update — October 21, 2026

Production now redirects HTTP requests for reactionjourney.com and www.reactionjourney.com to HTTPS with status 308. HTTPS responses use host-only HSTS with a one-day initial lifetime, X-Frame-Options DENY, and an enforced CSP covering frame-ancestors, object-src and base-uri. A broader CSP is report-only so sign-in, inline UI and YouTube embeds can be evaluated before restricting scripts. Report-only violations currently appear in browser developer tools; no remote report collector is configured.

The deployed change wraps the backed-up production bundle without changing its bytes. This preserves newer production application changes that were absent from the repository default branch. The Cloudflare content-only API preserved bindings and runtime configuration; only its triggered-by deployment annotation changed.

Validation: four passing tests, including the actual wrapped production bundle, HTTP redirect/query preservation, public scripts, anonymous API rejection, cookies, headers and scheduled-handler presence. Live checks confirmed HTTPS homepage 200, HTTP 308, security headers, private status 401 and sign-in/YouTube script responses. Signed-in Google flows were not exercised end to end.

Supabase remains on the Free plan. Its leaked-password protection feature requires Pro or above and remains disabled. No billing change was made. Official documentation: https://supabase.com/docs/guides/auth/password-security

Before the next application release, incorporate the equivalent source changes from this branch into the active production source. Deploying an older checkout without these changes would remove the Worker-level protections. Do not replace the current production application with an outdated main-branch build merely to add these headers.

After compatibility observations, tighten the report-only script policy and increase the HSTS lifetime. Subdomains and HSTS preload were deliberately excluded from this initial rollout.
