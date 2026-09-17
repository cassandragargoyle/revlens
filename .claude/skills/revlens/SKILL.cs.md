---
title: revlens — práce s nástrojem
description: Český překlad skillu pro práci s nástrojem revlens — sestavení bundlu revizí, ověření, spuštění prohlížeče, samostatný export a dotazy nad načteným bundlem. Zdrojem pravdy je anglická verze; tento soubor se z ní překládá.
category: skill
ai_load: on-demand
status: active
language: cs
translation_of: SKILL.md
created: 2026-09-16
last_updated: 2026-09-16
related:
  - ../../../docs/issues/002-document-revision-viewer.md
  - ../../../README.md
---

> **Zdrojem pravdy je [`SKILL.md`](SKILL.md)** — anglická verze, kterou načítá Claude Code
> jako skill. Tenhle soubor je její český překlad pro čtení; mění-li se chování skillu,
> mění se nejdřív anglický originál a překlad se dotáhne za ním.

# revlens

## Co to je

`revlens` ukazuje **finální text dokumentu s vyznačenými změnami** a u každé změny říká,
kdy vznikla, kdo ji způsobil a na základě které připomínky. Umí i opačný směr: projít
připomínky a zjistit, co se s nimi stalo — včetně těch, které se v textu vůbec neprojevily.

Zadání je [INT-002](../../../docs/issues/002-document-revision-viewer.md), vlastní
dokumentace nástroje je [`README.md`](../../../README.md).

## KROK 0: Najdi nástroj a připrav ho

`revlens` je samostatný repozitář a dokumenty, které čte, jsou v cizím. Session bývá
spuštěná v repozitáři dokumentu, ne v tomhle, takže nejdřív urči `TOOL`:

- je nastavené `$REVLENS_HOME` → to je nástroj
- existuje `./apps/cli/bin/revlens.js` → session běží přímo v repozitáři revlens
- jinak zkus sousední checkout: `../revlens`, pak `../../revlens`

Když není ani jedno, řekni to a zeptej se, kde je revlens naklonovaný. Neklonuj ho sám.

Nejsou-li v `TOOL/node_modules` závislosti nebo chybí `TOOL/apps/web/dist`, spusť:

```bash
cd "$TOOL" && npm install && npm run build
```

Build trvá desítky sekund. Bez něj `serve` poběží, ale bez prohlížeče (jen API), a
`--static` selže — v obou případech to řekni, nezakrývej to.

## KROK 1: Zjisti, co uživatel chce

Nepředpokládej. Nejčastější zadání a co na ně potřebuješ:

| Zadání | Potřebuješ zjistit |
| ------ | ------------------ |
| „ukaž, co se změnilo proti verzi X" | který commit odpovídá verzi X |
| „spusť to" | který bundle; existuje-li jich víc, zeptej se |
| „co udělala připomínka K…" | běžící server, nebo bundle k načtení |
| „co se ještě nezapracovalo" | totéž |
| „pošli to klientovi" | **zastav se** — viz KROK 5 |

## KROK 2: Najdi baseline

Baseline je **stav, který dostali recenzenti**, ne libovolný commit. Ptá-li se uživatel na
„proti verzi 1.5", hledej commit, kde dokument ještě nesl razítko 1.5 — poslední před
přepnutím na další verzi:

```bash
git -C "$ANALYSIS" log --format="%h|%aI|%s" -- analysis/structure.json | head -20
```

U každého kandidáta si přečti `document.version` z `analysis/structure.json` v tom commitu
a vezmi **poslední commit s hledanou verzí**. Nález uživateli ohlas i s datem a předmětem
commitu, ať si ho může ověřit — spletená baseline tiše zkreslí celý výstup.

## KROK 3: Postav bundle

```bash
cd "$TOOL" && node apps/cli/bin/revlens.js build \
  --source engagement \
  --repo "<cesta k repozitáři s kapitolami>" \
  --records "<cesta k repozitáři se záznamy>" \
  --from "<baseline commit>" \
  --out "out/<název>.json" \
  --report "out/<název>-report.json"
```

`--repo` je vnořené analytické repo — adresář končící na `-analysis`, ve kterém je
`analysis/structure.json` — a `--records` je zakázkový adresář o úroveň výš, s `docs/changes/`
a `docs/comments/`. Jiné zakázky adaptér
zatím nemají — `node apps/cli/bin/revlens.js sources` řekne, které existují.

`out/` je v `.gitignore`; bundle je generovaný soubor a **necommituje se**.

### Head je commit, ne pracovní kopie

`--to` bere revizi a výchozí je `HEAD`; režim, který by porovnával proti souborům na disku,
neexistuje. Co je rozepsané a není v commitu, **v bundlu chybí** a prohlížeč o tom mlčí.
Podívej se dřív, než stavíš:

```bash
git -C "<repozitář s kapitolami>" status --short
```

Změněné soubory vyjmenuj uživateli spolu s reportem. Jinak první změna, kterou nenajde,
padne na nástroj.

### Report čti nahlas, ne jen kvůli chybám

Z reportu uživateli vždy uveď:

- **`unexplained`** — kolik změn nemá doložený původ. Je to míra kvality napojení, ne chyba.
- **`comments X of Y joined`** — kolik připomínek se podařilo navázat.
- **kapitoly beze změn** — to je informace, ne prázdno.
- **`warnings`** — zejména hlášku, že se commity napojovaly přes cestu a datum místo hashe.

Odmítne-li build zapsat bundle kvůli porušeným invariantům, **nepřidávej `--allow-invalid`,
abys to obešel**. Vypiš chyby uživateli; je to nález v datech nebo v nástroji.

## KROK 4: Spusť prohlížeč

```bash
cd "$TOOL" && node apps/cli/bin/revlens.js serve "out/<název>.json"
```

Server drží terminál, dokud ho někdo nezastaví, a poslouchá jen na `127.0.0.1`. Adresu
uživateli napiš. **Nespouštěj ho na pozadí a nenech ho běžet bez vědomí uživatele** — na
tomhle stroji ho už dvakrát odstřelil systém kvůli paměti; když má běžet dlouho, ať si ho
uživatel spustí ve vlastním terminálu.

Je-li port obsazený, node spadne na `EADDRINUSE`. Zkontroluj, jestli už nějaká instance
neběží, než začneš hledat jinou příčinu.

## KROK 5: Předání ven — zastav se a zeptej

`revlens build --static <dir>` vyrobí samostatnou složku, která funguje bez serveru. Ta se
dá zazipovat a poslat.

**Než to komukoli pošleš, vyžádej si výslovný souhlas.** Bundle nese doslovné znění
připomínek, jména připomínkujících, interní rozhodnutí a poznámky — materiál je interní.
Co jde klientovi jako oficiální výstup, je pořád Word se sledovanými změnami; `revlens` je
čtecí pohled pro tým.

## KROK 6: Odpovídej nad bundlem

Ptá-li se uživatel na obsah, **nečti bundle ručně přes `grep`**. Běží-li server, použij API:

```bash
curl -s '127.0.0.1:4173/api/comments?decision=prijato&resolution=rozpracovano'
curl -s '127.0.0.1:4173/api/comments?landed=false'
curl -s '127.0.0.1:4173/api/edits?q=CTO'
curl -s '127.0.0.1:4173/api/comments/K2-004'
```

Neběží-li, nabídni `serve --mcp` a nástroje `revlens_comments`, `revlens_comment`,
`revlens_edit`, `revlens_search` — dávají stejné odpovědi jako prohlížeč, protože volají
stejné funkce.

### Když uživatel řekne, že změna v aktuálním textu není

Nepřebírej ten předpoklad a nepřestavuj bundle proti jiné základně, aby problém zmizel.
**Nejdřív najdi zdrojový soubor té kapitoly** — bundle ho nese v `chapter.source` — a
ověřuj v něm:

```bash
node -e 'const b=require("./out/<název>.json");console.log(b.chapters.map(c=>c.id+" <- "+c.source).join("\n"))'
```

Falešný poplach vzniká z grepu nad adresářem. V zakázce bývají **dva soubory
`GLOSSARY.md`**: ten v kořeni analytického repa je zdrojem kapitoly
„Pojmy a zkratky", zatímco ten v nadřazeném repozitáři zakázky je projektový glosář a do
dokumentu se nedostane. Nesou stejná hesla v jiném znění, takže grep ve špatném repozitáři
označí aktuální větu za neexistující.

Pak řekni, co platí — že text aktuální je a který commit ho vložil, nebo že bundle je
opravdu špatně. Ustoupit „máš pravdu, to je staré" tam, kde to není, stojí víc než ta
otázka.

### Slovník, který uživatel používá

Připomínka prochází **třemi branami** a odpovídají na různé otázky:

| Brána | Pole | Hodnoty |
| ----- | ---- | ------- |
| Ověření | `check.verdict` | `potvrzeno`, `potvrzeno-s-upresnenim`, `mimo-text`, `neplati` |
| Rozhodnutí | `decision.status` | `prijato`, `prijato-castecne`, `zamitnuto`, `odlozeno`, `nerozhodnuto` |
| Vypořádání | `resolution.state` | `hotovo`, `rozpracovano`, `nezahajeno`, `odpada` |

Zeptá-li se uživatel „co se ještě nezapracovalo", nemíchej brány dohromady: `landed=false`
znamená „nezměnilo v textu ani jedno místo", což není totéž co `resolution=rozpracovano`.
Když si nejsi jistý, který z těch dvou chce, zeptej se — čísla se liší řádově.

**Připomínky jsou ve výchozím stavu zúžené na porovnávaný rozsah.** Bundle nese všechny
připomínky, které kdy na zakázce přišly; ty uzavřené před baseline patří k dřívějšímu
srovnání a bez vyžádání se nezobrazují. API i MCP nástroj hlásí, v jakém rozsahu
odpověděly — uveď ho, ať si nikdo nesplete šířku seznamu:

```bash
curl -s '127.0.0.1:4173/api/comments?landed=false'              # otevřené v tomto srovnání
curl -s '127.0.0.1:4173/api/comments?scope=settled-earlier'     # uzavřené před baseline
curl -s '127.0.0.1:4173/api/comments?scope=all'                 # vše v bundlu
```

Dvě slova, která nejsou zaměnitelná: **uzavřeno** před baseline není **zapracováno do
textu**. Připomínka může být uzavřená jako zamítnutá, jako odpadlá, nebo jako zastřešující
rozpadlá do jiných. Nikdy neříkej čtenáři, že připomínka mimo rozsah už byla zapracovaná.

Build report počítá záznamy mimo rozsah odděleně od těch, které se napojit skutečně
nepodařilo — uveď obojí a nevydávej počet mimo rozsah za slabinu napojení.

## Odkazy, které dáváš uživateli

- `#/edit/…`, `#/revision/…`, `#/comment/…` **přežijí přegenerování** bundlu i změnu
  baseline; id se odvozují z obsahu změny, ne z pozice.
- `ch-04-wp-a1/b-17` (id bloku) **nepřežije** — platí jen uvnitř jednoho bundlu.
- Výjimka, kterou přiznávej: dvě bajtově identické změny téže revize se od sebe liší jen
  pořadím, takže zmizí-li jedna z nich, může se id té druhé posunout.

## Když měníš samotný nástroj

Kód je v tomhle repozitáři. Než cokoli ohlásíš jako hotové:

```bash
cd "$TOOL" && npm run lint && npm run build && npm run schema:check && npm test
```

- `schema/bundle.schema.json` se **generuje** ze Zod schématu v `packages/core`. Needituj
  ho ručně — `npm run schema` ho přepíše a `schema:check` selže v CI.
- Změna kontraktu (`packages/core/src/schema.ts`) je **změna zadání INT-002**; zapiš ji tam.
- Navigační a filtrovací pravidla patří do `packages/core`, aby prohlížeč, API i MCP
  dávaly stejnou odpověď. Nepiš je podruhé v UI.
- Nové chování ověř na **reálné historii**, ne jen na syntetické. Dvě chyby v atribuci se
  na pětikomitové testovací historii neprojevily a na 83 commitech zakázky vyrobily
  41 porušených invariantů.
