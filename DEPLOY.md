# Deploy ZetaCore AI to Netlify

## Connect the GitHub repository

1. Push the project, including `netlify.toml` and `netlify/functions/api.mjs`, to GitHub. Keep `.env` out of Git; it contains private credentials and is git-ignored.
2. In [Netlify](https://app.netlify.com/), choose **Add new project > Import an existing project**, connect GitHub, and select the ZetaCore repository.
3. Leave the build command empty and publish directory as `.` (these are also configured in `netlify.toml`), then deploy.
4. In **Project configuration > Environment variables**, add these server-side variables for the Functions scope:
   - Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - Add newly rotated `GEMINI_API_KEY` and/or `GEMINI_API_KEY_2`, and `OPENROUTER_API_KEY` as used by the project.
   - `SUPABASE_SERVICE_ROLE_KEY` is optional and only needed for permanent account deletion.
   Never put provider keys in frontend code or commit them to Git.
5. Trigger a new deploy after setting or changing environment variables.
6. Copy the site URL Netlify assigns (for example, `https://<site-name>.netlify.app`). In Supabase **Authentication > URL Configuration**, set the Site URL to that URL and add `https://<site-name>.netlify.app/index.html` (including the app's redirect query strings) to allowed redirect URLs. Keep the Google OAuth provider's callback URI set to the Supabase callback URL shown in Supabase.

Netlify's assigned `netlify.app` URL is free. A custom domain requires a domain you own.

## Runtime notes

Netlify hosts the HTML as static files and runs the existing API through a serverless Function; it does not run the local Node HTTP server continuously. Functions are invoked on requests, so this hosting is not a continuously running VPS. Netlify's buffered function request/response payload limit is 6 MB; image attachments encoded into chat requests may hit this limit before the app's local server limit.
