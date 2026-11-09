#!/usr/bin/env bash
#
# I campi password dell'editor passano tutti da `CampoPassword`?
#
# PERCHÉ ESISTE
#
# Sul pannello, col touch e la tastiera a schermo, una password si sbaglia
# facilmente e non si vede dove: «è l'utente che fa show quando è in condizioni
# di sicurezza» (maintainer, 09-11-2026). L'occhio che mostra quello che si è
# scritto sta in `sws-editor/src/components/CampoPassword.tsx`, e il maintainer
# lo vuole **ovunque**: IDE, console, viewer del pannello, LVGL. Il giorno in
# cui è nato i `type="password"` scritti a mano erano 33 in 22 file, più tre
# `type={…}` che decidevano al volo. Un campo nuovo scritto a mano fra sei
# mesi sarebbe l'unico senza occhio, e nessuno se ne accorgerebbe finché un
# operatore non sbaglia la password davanti al pannello.
# Piano: docs/plans/2026-11-09-occhio-sulle-password.md
#
# COSA PRETENDE
#
#   nei .tsx di sws-editor/src fuori da CampoPassword.tsx, commenti esclusi
#   (`//` a inizio riga, `/* … */`, `{/* … */}`):
#
#   - nessun `type=` con «password» scritto per esteso, comunque lo si scriva:
#     `type="password"`, `type='password'`, `type={"password"}`,
#     `type={'password'}`, `type={`password`}`, `type={a ? "text" : "password"}`,
#     anche spezzato su più righe;
#   - nessun `type: "password"` in un oggetto di prop;
#   - nessun `<input … autoComplete="current-password" | "new-password">`: un
#     campo che si dichiara password al browser senza esserlo per l'occhio.
#
#   La prima stesura vedeva solo `type="password"` e `type={… "password"}` su
#   una riga: la revisione del 09-11-2026 le ha fatto passare apici singoli,
#   template literal e l'attributo a capo. Da allora lo script prova sé stesso
#   a ogni giro su un frammento con le evasioni note (sotto, `autotest`).
#
#   Un `type={variabile}` su `<input>` da qui non si giudica — oggi ce ne sono
#   tre, legittimi: planimetrie, S7, EtherNet/IP, con tipi text/number — e non
#   si guarda. Chi scrive un campo password con un tipo calcolato lo decida
#   alla chiamata, come fa DatastoresTab:
#   `field === "password" ? <CampoPassword …/> : <input …/>`.
#
# Uso:  ./scripts/check_campi_password.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Stampa `file:riga: frammento` per ogni campo password scritto a mano nei
# .tsx sotto la cartella data, CampoPassword.tsx escluso, commenti tolti.
scansiona() {
  find "$1" -name '*.tsx' ! -name 'CampoPassword.tsx' -print0 | sort -z | xargs -0 -r perl -e '
    for my $f (@ARGV) {
      open my $h, "<", $f or die "$f: $!"; local $/; my $s = <$h>; close $h;
      # I commenti spariscono ma le loro righe restano, così i numeri tornano.
      $s =~ s{/\*.*?\*/}{ (my $c = $&) =~ tr/\n//cd; $c }gse;
      $s =~ s{^[ \t]*//[^\n]*}{}gm;
      my $virg = q{[\x60"\x27]};
      my $re = qr/
          type\s*=\s*\{?\s*${virg}password${virg}           # type="password", type={`password`}, anche a capo
        | type\s*=\s*\{[^}]*?${virg}password${virg}         # type={a ? "text" : "password"}
        | type\s*:\s*${virg}password${virg}                 # { type: "password" } in un oggetto di prop
        | <input\b(?:=>|[^>])*?autoComplete\s*=\s*["\x27](?:current|new)-password   # un <input> che si dice password al browser
      /xs;
      while ($s =~ /($re)/g) {
        my $riga = 1 + (substr($s, 0, $-[0]) =~ tr/\n//);
        (my $fr = $1) =~ s/\s+/ /g;
        print "$f:$riga: $fr\n";
      }
    }
  '
}

# Lo script prova sé stesso: le evasioni note devono scattare, il resto no.
autotest() {
  local albero; albero=$(mktemp -d)
  cat > "$albero/Evasioni.tsx" <<'TSX'
// In un commento: <input type="password" /> — non deve scattare
/* type="password" nemmeno qui,
   su due righe */
export function Evasioni({ tipo }: { tipo: string }) {
  return (
    <>
      {/* type="password" neanche in un commento JSX */}
      <input type="password" />
      <input type='password' />
      <input type={`password`} />
      <input type={"password"} />
      <input type={tipo === "x" ? "text" : "password"} />
      <input
        type=
          "password" />
      <input onChange={(e) => e} autoComplete="current-password" />
      <input type={tipo} />
      <input type="text" autoComplete="off" />
      <CampoPassword autoComplete="new-password" value="" onChange={() => {}} />
    </>
  );
}
const props = { type: "password" };
TSX
  # La riga è quella del `type=`, anche quando l'attributo è a capo (14).
  local attese="8 9 10 11 12 14 16 23"
  local trovate
  trovate=$(scansiona "$albero" | sed -E 's/^[^:]+:([0-9]+):.*/\1/' | sort -n | tr '\n' ' ' | sed 's/ $//')
  rm -rf "$albero"
  if [ "$trovate" != "$attese" ]; then
    echo "  ✗ check_campi_password non riconosce le sue evasioni: righe trovate «$trovate», attese «$attese»"
    return 1
  fi
}

autotest

trovati=$(scansiona sws-editor/src)
if [ -n "$trovati" ]; then
  echo "  ✗ campi password fuori da CampoPassword (senza l'occhio):"
  echo "$trovati" | sed 's/^/      /'
  exit 1
fi
n=$(grep -rn --include='*.tsx' '<CampoPassword' sws-editor/src | wc -l || true)
echo "  ✓ nessun campo password a mano: $n campi passano da CampoPassword (autotest su 8 evasioni ok)"
