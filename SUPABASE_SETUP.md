# Supabase authentication setup

## Project configuration

The Supabase project URL and publishable `anon` key are configured in the sign-in page, dashboard, and server. The `anon` key is intended to be public; never put a Supabase `service_role` key or an AI-provider key in browser code.

Start the app from this folder with Node.js 20.6 or later:

```powershell
node --env-file=.env server.mjs
```

Open `http://localhost:3000`. Do not open `index.html` with `file://` or a static-only preview: the authenticated chat API is served by `server.mjs`.

## Email sign-up confirmation links

1. In Supabase, open **Authentication → Providers → Email** and enable email confirmations.
2. Open **Authentication → Email Templates → Confirm signup**. Use Supabase's confirmation link (`{{ .ConfirmationURL }}`), for example:

   ```html
   <h2>Confirm your email address</h2>
   <p>Select this link to confirm your ZetaCore AI account:</p>
   <p><a href="{{ .ConfirmationURL }}">Confirm your email address</a></p>
   ```

   Do not replace the confirmation link with `{{ .Token }}`. The app completes email verification through the emailed link, not a code-entry screen.
3. Set **Authentication → URL Configuration → Site URL** to `http://localhost:3000`.
4. Add `http://localhost:3000/index.html?verified=1` and `http://localhost:3000/dashboard.html` to the allowed redirect URLs.

Full name and date of birth are stored as Supabase Auth user metadata (`full_name` and `date_of_birth`). Email must be verified before the user can sign in. The password and its confirmation are never saved as profile metadata.
After following the confirmation link, the user returns to the login screen and signs in with their password.

## Google sign-in

The app must be opened through the Node server at `http://localhost:3000`; OAuth does not work from a `file://` URL. The Google provider error `Unsupported provider: provider is not enabled` means Google sign-in is disabled or not configured in Supabase.

1. Create a Web OAuth client in Google Cloud Console.
2. Add `https://dlidztiuttjwloyvdyeb.supabase.co/auth/v1/callback` as an authorized redirect URI in Google Cloud.
3. In Supabase, open **Authentication → Providers → Google**, enable Google, and paste the Google OAuth client ID and secret there. Save the provider settings.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` and allow `http://localhost:3000/index.html?oauth=1` and `http://localhost:3000/dashboard.html`.
5. Restart/open the app from `http://localhost:3000` and select **Continue with Google**.

The app asks Google to show its account chooser on each sign-in. After Google confirms sign-in, first-time or incomplete profiles are asked for their full name, date of birth, and gender before continuing to the dashboard. These values are saved in Supabase Auth user metadata. Users with a completed profile continue directly to the dashboard on later Google sign-ins.

For an email account and Google account with the same verified email address to use the same Supabase user, leave Supabase identity linking enabled and ensure the email provider requires confirmation. Supabase links verified identities with the same email; do not manually create a second account for that address.

For a deployed site, replace the localhost Site URL and allowed URLs with the exact HTTPS app URLs. The Google Cloud authorized redirect URI remains the Supabase callback URL above.

## Account settings and deletion

The dashboard profile settings update Auth user metadata and support email/password changes and phone-number verification. Email and phone changes require the user to complete Supabase's verification flow. Phone sign-in/change also requires an SMS provider configured in **Authentication → Providers → Phone**.

Temporary deactivation marks the signed-in user's metadata, signs them out, and blocks chat API access until the user signs in again. Signing in reactivates the account.

Permanent account deletion requires the server-only `SUPABASE_SERVICE_ROLE_KEY` setting in `.env`. Copy the service-role/secret key from the Supabase project's API settings into that local environment variable, restart the Node server, and never expose or share this key. The delete endpoint only deletes the authenticated user's own Supabase Auth account and requires entering the matching account email. It does not erase data stored outside Supabase Auth.

## AI model providers

AI provider credentials belong only in the server's local `.env` file. Never put provider keys in `dashboard.html`, browser storage, or a message. After changing `.env`, restart the Node server; the dashboard reads the enabled model choices from `/api/status`.

- **Gemini:** set `GEMINI_API_KEY` to a key from Google AI Studio. The server offers Gemini 2.5 Flash Lite for Instant and Gemini 2.5 Flash for Deep Reason.
- **OpenRouter:** set `OPENROUTER_API_KEY` to an OpenRouter key. On startup, the server fetches OpenRouter's current model catalog and adds free text models that support temperature for both Instant and Deep Reason. The selected catalog model ID is sent to OpenRouter by the server. Availability and access depend on OpenRouter and the key.
- **Other OpenAI-compatible APIs:** set `CUSTOM_MODELS` to a JSON array and set the environment variable named by each route's `apiKeyEnv` field. For example:

  ```dotenv
  CUSTOM_MODELS=[{"id":"my-fast-model","label":"My Fast Model","mode":"instant","url":"https://api.example.com/v1/chat/completions","model":"vendor/model-id","apiKeyEnv":"MY_MODEL_API_KEY"}]
  MY_MODEL_API_KEY=your_provider_api_key
  ```

  Use `mode` `instant` or `deep`; each entry adds one model route. Custom endpoints must use HTTPS, except localhost endpoints used for development. Keep the `.env` file private and uncommitted.

When no provider key is configured, the dashboard still offers Automatic fallback but requests cannot be answered until a provider is enabled. OpenRouter model discovery requires network access when the server starts. Restart the server after adding or rotating a key, then refresh the dashboard to load the fetched model list. Only free OpenRouter catalog entries are shown so selecting a discovered model does not unexpectedly choose a paid model.

If chat displays **“All configured model providers failed”**, check the PowerShell terminal running `server.mjs` for the `[provider fallback]` message. It reports the upstream HTTP status or timeout without exposing the API key. Verify that the key in `.env` is valid, the selected model is available to that key, and the provider account has quota; then restart the server and refresh the dashboard.

The dashboard uses ZetaCore-branded model names. The server keeps provider routing and model IDs private to the backend; if users directly ask which external provider is powering a response, the assistant is instructed to answer honestly.

## Cloud-saved chat history

Chats are saved in Supabase and are available after browser reload or signing in on another device. In the Supabase dashboard, open **SQL Editor → New query**, run the following once, then reload the ZetaCore dashboard:

```sql
create table if not exists public.zetacore_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zetacore_conversations_user_updated_idx
  on public.zetacore_conversations (user_id, updated_at desc);

alter table public.zetacore_conversations enable row level security;

create policy "Users can read their own chats"
  on public.zetacore_conversations for select
  to authenticated using ((select auth.uid()) = user_id);

create policy "Users can create their own chats"
  on public.zetacore_conversations for insert
  to authenticated with check ((select auth.uid()) = user_id);

create policy "Users can update their own chats"
  on public.zetacore_conversations for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own chats"
  on public.zetacore_conversations for delete
  to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.zetacore_conversations to authenticated;
```

Each account can only read or change its own rows through Supabase Row Level Security. New conversations are titled from the first message; the sidebar supports pin/unpin, rename, archive/restore, and permanent delete. Archived chats remain in the Archived section until restored or deleted. Chat history is stored as conversation messages in the user's Supabase project, so apply your project's retention and privacy policies.

## Forgot password

The sign-in screen uses Supabase's password-reset email flow. Keep `http://localhost:3000/index.html?recovery=1` in the allowed redirect URLs. Supabase's reset email template should use its recovery link so the user returns with a valid recovery session.
