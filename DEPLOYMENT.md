# TafelFlow – Produktion (Vercel + Supabase)

## Umgebungsvariablen (Vercel)

Im Vercel-Projekt unter **Settings → Environment Variables** für **Production** (und bei Bedarf **Preview**) setzen:

| Name | Wert |
|------|------|
| `VITE_SUPABASE_URL` | Project URL aus Supabase (Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | `anon` `public` Key (Settings → API) |

Nach dem ersten Eintrag oder Änderung: **Redeploy** auslösen, damit der Build die Variablen einbindet.

Lokal: `.env.local` (nicht committen) analog zu `.env.example`.

## Supabase

1. **Schema:** SQL aus `supabase/schema.sql` bzw. die Migrationen in `supabase/migrations/` der Reihe nach ausführen.
2. **Authentication – keine öffentliche Selbstregistrierung**
   - **Authentication → Providers → Email:** **„Enable Sign up“ / Benutzerregistrierung** deaktivieren (nur noch Anmeldung mit bestehendem Konto; `signUp` über die öffentliche API schlägt dann fehl).
   - Optional dieselbe Prüfung für weitere Provider (z. B. Google), falls aktiv.
   - **Email**-Provider bleibt für **Login** (E-Mail + Passwort) aktiv.
   - **Anonymous sign-ins** aktivieren (Schülerbeitritt ohne Lehrkraft-Konto).
3. **Lehrkräfte anlegen (nur Administrator)**  
   Im Dashboard **Authentication → Users** einen Nutzer anlegen (**Add user** / Einladung) oder per **Supabase Admin API** / CLI. Anschließend in **`public.profiles`** die Rolle setzen:

   ```sql
   update public.profiles set role = 'teacher' where id = '<user-uuid>';
   ```

   (Neue Auth-User erhalten per Trigger zunächst oft `role = 'student'` – für Dashboard-Zugang explizit `teacher` setzen.)
4. **Redirect URLs** (Authentication → URL Configuration):
   - **Site URL:** z. B. `https://deine-app.vercel.app`
   - **Redirect URLs** (jeweils eigene Zeile):
     - `https://deine-app.vercel.app/auth/callback`
     - `http://localhost:5173/auth/callback` (nur für lokale Entwicklung)

## Vercel-Build

- **Framework Preset:** Vite  
- **Build Command:** `npm run build`  
- **Output Directory:** `dist`  
- `vercel.json` sorgt dafür, dass Client-Routen (z. B. `/login`, `/session/…`) beim Direktaufruf auf `index.html` fallen.

## Updates (Git → Vercel)

1. Änderungen committen und zu GitHub pushen.
2. Vercel baut bei Push auf den verbundenen Branch automatisch (sofern das Projekt mit dem Repo verknüpft ist).
3. Neue ENV-Werte nur in Vercel ändern und erneut deployen.

## Kein Demo-Modus

Die App erwartet gültige Supabase-ENV-Variablen. Ohne diese erscheint eine Vollbild-Konfigurationsmeldung – es gibt keinen lokalen Demo-Client mehr.
