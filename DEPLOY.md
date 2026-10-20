# Deploy ZetaCore AI

## Vercel

1. Import the GitHub repository into [Vercel](https://vercel.com/) and use the repository root as the Root Directory.
2. Keep the Framework Preset as **Other**, leave the Build Command empty, and use `.` as the Output Directory. `vercel.json` sets these deployment defaults and maps `/` to `dashboard.html`.
3. `api/[...path].mjs` exposes the API in `server.mjs` as a Vercel Function. Keep `.env` out of Git; it contains private credentials and is git-ignored.
4. In **Project Settings > Environment Variables**, add these server-side variables:
   - Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - Add newly rotated `GEMINI_API_KEY` and/or `GEMINI_API_KEY_2`, and `OPENROUTER_API_KEY` as used by the project.
   - `SUPABASE_SERVICE_ROLE_KEY` is optional and only needed for permanent account deletion.
   Never put provider keys in frontend code or commit them to Git.
5. Trigger a new deployment after pushing changes or changing environment variables.
6. In Supabase **Authentication > URL Configuration**, set the Site URL to the Vercel deployment URL and add its `/index.html` URL (including the app's redirect query strings) to allowed redirect URLs. Keep the Google OAuth provider's callback URI set to the Supabase callback URL shown in Supabase.
7. The public sign-in page links to `/terms.html`. Email sign-up and sign-in require acceptance; the acceptance timestamp is saved in Supabase user metadata. Google sign-in also requires the checkbox and records acceptance after the OAuth redirect.

## Netlify

Netlify remains supported through `netlify.toml` and `netlify/functions/api.mjs`. Configure the same environment variables in the Netlify project's Functions environment and deploy there instead.

Both providers host the HTML statically and invoke the API on requests; neither runs the local Node HTTP server continuously. Netlify's buffered function request/response payload limit is 6 MB, so large image attachments may exceed that limit.

Automatic model selection uses the configured Gemini route and two known text-chat OpenRouter fallbacks. It does not fetch the OpenRouter model catalog during cold start or route requests to audio/video models. Provider attempts time out after 10 seconds before the next provider is tried.

## Google Search

The public login page has basic search metadata and structured data; the signed-in dashboard is marked `noindex`. `robots.txt` and `sitemap.xml` help crawlers discover the public root page. After deploying, add `https://zetacoreai.vercel.app/` as a URL-prefix property in [Google Search Console](https://search.google.com/search-console/), complete its ownership verification, submit `https://zetacoreai.vercel.app/sitemap.xml`, then use URL Inspection to request indexing for the root URL. Indexing and ranking take time, and Google does not guarantee a first-place result. A useful public landing page with original details about the product will give search engines more content to evaluate than a sign-in page alone.
