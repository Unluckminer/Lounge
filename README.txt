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
     (Mit einem Tag wie v1.2.0 legt der Workflow stattdessen ein Release an.)

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
macOS  : Beim ersten Start Rechtsklick > Oeffnen. Bei "ist beschaedigt": im Terminal  xattr -cr /Applications/"TV Launcher.app"
         Fuer das Handy-Touchpad: Bedienungshilfen erlauben, optional  brew install cliclick
Linux  : benoetigt xdotool (X11): sudo apt install xdotool
Fehlerprotokoll: error.log im Datenordner der App.
