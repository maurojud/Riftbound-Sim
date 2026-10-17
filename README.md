# Riftbound Table

Digitaler Spieltisch für Riftbound vor Ort: Der Fernseher zeigt den Tisch, jedes Tablet oder Handy zeigt die eigenen Handkarten (und auf Wunsch den ganzen Tisch). Es gibt **keine Regel-Engine**. Die Spieler halten sich selbst an die Regeln, die App verwaltet nur Karten, Zonen und Sichtbarkeit.

## Update auf eine bestehende Datenbank

Wenn du die erste Version schon eingerichtet hast: Inhalt von `supabase/migration-2.sql` einmal im Supabase SQL Editor ausführen (fügt die Spalte für Runenfarben hinzu und beschleunigt Live-Updates). Danach beim Master unter „Karten verwalten“ den Runen eine **Farbe** zuweisen.

## Funktionen

- Konten mit Benutzername (Supabase Auth)
- Session am Fernseher erstellen: 5-stelliger Code + Passwort, Beitritt mit Tablet/Handy (bis 4 Spieler)
- Zuschauermodus (sieht nur den Tisch)
- Spielen ohne Fernseher: Session auf dem eigenen Gerät erstellen und mitspielen, Tab „Ganzer Tisch“
- Zonen pro Spieler: Hand, Base, Battlefield, Deck (40), Runendeck (12, verdeckt), Legend, Champion, Runenzone, Trash, Banish; Tappen, Verdecken, Verschieben, Ziehen, Mischen, Punktezähler
- Deckregeln im Deckbuilder: max. 3 Kopien, 40 Karten, 1 Legend, 3 Battlefields, 12 Runen in max. 2 Farben
- Live-Updates über Broadcast (sofort) plus Datenbank als Absicherung
- Sichtbarkeits-Einstellungen pro Session (Gegner-Trash, Runen, Handkartenanzahl)
- Deckbuilder pro Konto
- Master-Konto: Kartenbilder hochladen (mehrere auf einmal), umbenennen, Art zuweisen, löschen

## Einrichtung

1. Supabase-Projekt erstellen (supabase.com).
2. Im **SQL Editor** den Inhalt von `supabase/schema.sql` ausführen.
3. Unter *Authentication → Providers → Email* optional „Confirm email“ ausschalten, dann geht die Registrierung ohne Mail-Bestätigung.
4. `.env.example` nach `.env` kopieren und Project URL sowie anon key eintragen (*Project Settings → API*).
5. `npm install`, dann `npm run dev`.
6. Ein Konto registrieren und zum Master machen (SQL Editor):

   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'deine@mail.ch');
   ```
   Danach erscheint oben „Karten verwalten“.

## Veröffentlichen (GitHub Pages)

1. Repo auf GitHub erstellen und den Code pushen (Branch `main`).
2. *Settings → Pages → Source: GitHub Actions*.
3. *Settings → Secrets and variables → Actions*: `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen.
4. Beim nächsten Push baut und veröffentlicht `.github/workflows/deploy.yml` die Seite. Alternativ geht auch Vercel oder Netlify (Build `npm run build`, Ordner `dist`, dieselben zwei Variablen).

Der anon key darf öffentlich sein, die Zugriffe werden durch die Row-Level-Security-Regeln in `schema.sql` geschützt.

## Bedienung

- **Fernseher:** anmelden, „Erstellen als Fernseher“. Code, Passwort und Link stehen oben.
- **Tablet/Handy:** anmelden, Code und Passwort eingeben (oder den Link `#/join/CODE` öffnen), „Mitspielen“, Deck wählen.
- Beim Start wählst du dein Battlefield (oder es wird zufällig zugewiesen, einstellbar) und einen Champion aus deinem Deck. Es wird nichts automatisch gezogen.
- Tippe auf eine Karte, um sie auszuwählen: Die Leiste unten zeigt Tappen, Verdecken und alle Zonen, in die sie darf. Handkarten liegen als Fächer unten, die gewählte Karte hebt sich an.
- Tippe auf Deck oder Runendeck, um zu ziehen. Deck und Runendeck lassen sich nicht ansehen.
- Runen dürfen nur tappen oder auf/unter das Runendeck, die Legend nur tappen. Alle anderen Karten dürfen in jede Zone.

## Wichtig zu wissen

- **Handkarten sind nur in der Oberfläche versteckt.** Alle Spielerzustände liegen in einer Datenbankzeile, die alle Mitglieder der Session lesen können. Für Spiele unter Freunden reicht das, ein technisch manipulationssicherer Modus wäre ein nächster Ausbauschritt.
- Jeder Spieler schreibt nur seinen eigenen Platz. Karten zwischen Spielern verschieben geht in dieser Version nicht.
- **Kartenbilder:** Der Speicher-Bucket `cards` ist öffentlich lesbar (Bild-URLs funktionieren ohne Login). Lade keine urheberrechtlich geschützten Kartenbilder in eine öffentlich nutzbare Instanz und lege sie nicht ins GitHub-Repo. Die Bilder liegen nur bei Supabase.

## Ideen für später

QR-Code zum Beitreten, Karten per Drag & Drop frei auf dem Spielfeld platzieren, Würfel/Token, Sitzplatz-Rotation am Fernseher, strengere Privatsphäre für Handkarten, einfache Regelhilfen.
