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
2. **Authentication**
   - **Email**-Provider aktivieren (für Login/Registrierung).
   - **Anonymous sign-ins** aktivieren (für Schülerbeitritt ohne Lehrkraft-Login).
3. **Redirect URLs** (Authentication → URL Configuration):
   - **Site URL:** z. B. `https://deine-app.vercel.app`
   - **Redirect URLs** (jeweils eigene Zeile):
     - `https://deine-app.vercel.app/auth/callback`
     - `http://localhost:5173/auth/callback` (nur für lokale Entwicklung)
4. **Lehrkraft-Rolle:** Neue Nutzer erhalten per Trigger die Rolle `student` in `profiles`. Lehrkräfte brauchen `role = 'teacher'`:

   ```sql
   update public.profiles set role = 'teacher' where id = '<user-uuid>';
   ```

   Die UUID findest du unter Authentication → Users.

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
