Lounge (TV Launcher) - Quellcode
================================

ENDNUTZER brauchen nur EINE Datei (keine Installation, kein Node.js, keine Ordner):
  Windows : Lounge-Windows.exe      (Doppelklick)
  macOS   : Lounge-macOS.dmg        (oeffnen, in "Programme" ziehen; beim ersten Start Rechtsklick > Oeffnen)
  Linux   : Lounge-Linux.AppImage   (Rechtsklick > Eigenschaften > "Ausfuehren erlauben", dann Doppelklick)

DATEIEN BAUEN (einmalig, nur fuer den Entwickler)
-------------------------------------------------
Variante A - alle drei Systeme automatisch (empfohlen):
  1. Diesen Ordner in ein neues GitHub-Repository hochladen.
  2. Tab "Actions" > "Lounge bauen" > "Run workflow".
  3. Nach ein paar Minuten die drei Dateien unter "Artifacts" herunterladen.
     (Mit einem Tag wie v1.4.1 legt der Workflow stattdessen ein Release an.)

Variante B - nur Windows, auf dem eigenen PC:
  EXE-bauen-Windows.bat doppelklicken. Ergebnis: dist\Lounge-Windows.exe

macOS/Linux lokal: npm install && npm run dist:mac  bzw.  npm run dist:linux  (jeweils auf dem passenden System).

Ausprobieren ohne Bauen: npm install && npm start

HINTERGRUNDBILDER
-----------------
Die mitgelieferten Standardbilder liegen in renderer/wallpapers/. Bilder (jpg/png/webp) dort hineinlegen oder austauschen,
neu bauen - sie laufen automatisch in der Diashow. Eigene Bilder fuegt man spaeter in der App hinzu (Einstellungen > Aussehen).

Hinweise
--------
Windows: SmartScreen zeigt ggf. "Der Computer wurde geschuetzt" > "Weitere Informationen" > "Trotzdem ausfuehren" (die Datei ist nicht signiert).
         Beim allerersten Start entpackt sich die Datei kurz, es kann einige Sekunden dauern, bis das Fenster erscheint.
macOS  : Beim ersten Start Rechtsklick > Oeffnen. Bei "ist beschaedigt": im Terminal  xattr -cr /Applications/"Lounge.app"
         Fuer das Handy-Touchpad: Bedienungshilfen erlauben, optional  brew install cliclick
Linux  : benoetigt xdotool (X11): sudo apt install xdotool
Fehlerprotokoll: error.log im Datenordner der App.

NEU IN VERSION 1.3
------------------
- Klarer Hintergrund ohne Weiß-/Schwarzschleier, echtes Liquid Glass (Lichtbrechung statt nur Unschärfe, je tiefer desto stärker).
- Widgets: weiß, in der Größe frei veränderbar (Layout bearbeiten: Ecke ziehen, S/M/L oder Umschalt + Pfeile). Neu: Vorhersage, Aufgaben, Timer/Stoppuhr, System, Countdown.
- Einstellungen: Reiterleiste bleibt fest oben.
- Diashow wie Apple TV: zufällige Reihenfolge, langsame Kamerafahrt, sanfte Überblendung (Bilder in renderer/wallpapers/).
- Strg + L: Overlay-Menü unten über jeder Lounge-App (Home, Aufgabe wechseln, Vollbild an/aus, Splitscreen, App schließen, Lounge schließen). Auch per Rad-Symbol oben und per Handy-Fernbedienung (Knopf "Menü").
- Ladeanimation beim Öffnen einer App.
- Schnellstart ganz oben: kleine Icons, Programm öffnet sich normal (ohne Vollbild, ohne Electron-Fenster).
- Programm hinzufügen: Dropdown mit gerade geöffneten Programmen und zufälligen Vorschlägen aus den installierten.
Hinweis: Strg + L ist nur aktiv, solange Lounge im Vordergrund ist oder eine Lounge-App läuft, damit es in normalen Programmen frei bleibt.
Fenster-Steuerung (Splitscreen, Vollbild aus) nutzt unter Windows PowerShell, unter Linux xdotool, unter macOS Bedienungshilfen.

NEU IN VERSION 1.4
------------------
- Strg + L repariert: Menü öffnet sich robust, Pfeiltasten/Enter/Esc funktionieren auch, wenn die andere App im Fokus bleibt.
- Konto (E-Mail oder Google), Freunde mit Live-Status, News-Ticker unten rechts -> Einrichtung siehe ADMIN-ANLEITUNG.txt (backend.json + supabase/setup.sql).
- Einstellungen > Fernbedienung: Mauszeiger vergrößern (Haken + Regler).
- Gruß, Uhr und Datum sind eigene Widgets, alle Widgets lassen sich an allen Ecken und Kanten skalieren.
- Größerer Widget-Bereich, Schnellstart und Apps weiter unten, flüssigeres Scrollen.

NEU IN VERSION 1.4.1
--------------------
- Automatische Updates über GitHub-Releases (Anleitung: ADMIN-ANLEITUNG.txt, Abschnitt "Automatische Updates").
- Windows-Build jetzt als Installer (Lounge-Windows-Setup.exe, aktualisiert sich selbst) und weiterhin als Portable.
- Statistik der aktiven Nutzer im Supabase-Dashboard (select * from stats;).
