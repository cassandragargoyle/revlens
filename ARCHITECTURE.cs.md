---
title: Architektura RevLens
description: Český překlad popisu architektury RevLens — dělba odpovědnosti mezi backendem, `core` a frontendem, role bundle.json, studený start deep linku a rebuild řízený asistentem. Načti při práci na nástroji revlens v `tools/revlens/`.
category: reference
ai_load: on-demand
status: active
language: cs
translation_of: ARCHITECTURE.md
created: 2026-09-16
last_updated: 2026-09-16
related:
  - docs/adr/ADR-004-revlens-attribution-token-blame.md
  - docs/adr/ADR-005-revlens-node-workspace-packaging.md
---

# Architektura RevLens

> Tento soubor je **český překlad** dokumentu [`ARCHITECTURE.md`](ARCHITECTURE.md)
> (anglický originál — zdroj pravdy). Při jakékoli úpravě obsahu synchronizuj obě
> verze; pokud se rozcházejí, platí anglická.

## Přehled

Jak je práce rozdělená mezi backend a frontend a proč je rozdělená právě takto.

Krátká verze: **backend rozhoduje, jaké změny nastaly, frontend rozhoduje, jak se čtou,
a `core` vlastní každé pravidlo, na kterém se oba musí shodnout.** Atribuce se vyřeší
jednou, při buildu, takže prohlížeč nikdy nepočítá offsety a zvýraznění nemůže vyjet
z místa. Navigace a filtrování žijí v `core`, ne v prohlížeči, protože HTTP API a MCP
nástroje odpovídají na tytéž otázky — a asistent, který by se se čtenářem neshodl na tom,
které úpravy revize vyrobila, by nástroj jako důkazní materiál znehodnotil.

Rozhodnutí, ze kterých tento tvar vychází, jsou zaznamenána v
[ADR-004](docs/adr/ADR-004-revlens-attribution-token-blame.md)
(algoritmus atribuce) a
[ADR-005](docs/adr/ADR-005-revlens-node-workspace-packaging.md)
(runtime a balení).

## Dělba odpovědnosti

```mermaid
flowchart TB
  subgraph sources["Zdroje pravdy (jen pro čtení)"]
    direction LR
    git[("git historie<br/>kapitoly analýzy")]
    changes[("docs/changes/v*<br/>changes.json")]
    comments[("docs/comments/K*<br/>K*.json")]
  end

  subgraph backend["Backend — Node.js"]
    direction TB

    subgraph buildtime["Build time — @revlens/adapters"]
      parse["Parsování kapitol<br/>remark na bloky"]
      match["Párování bloků<br/>Dice nad bigramy"]
      blame["Token blame<br/>s náhrobky"]
      join["Spojení commitů<br/>s pokyny a komentáři"]
      emit["Emise runs a edits<br/>+ build report"]
      parse --> match --> blame --> join --> emit
    end

    subgraph runtime["Runtime — @revlens/server"]
      api["HTTP API<br/>bundle, chapters, revisions"]
      mcp["MCP server<br/>stdio, s --mcp"]
      rebuild["POST /api/rebuild<br/>znovu spustí adaptér"]
      staticsrv["Statické hostování<br/>sestavené SPA"]
    end
  end

  subgraph core["@revlens/core — sdílený kontrakt"]
    direction LR
    zod["Zod schéma<br/>+ generované JSON Schema"]
    inv["Validace invariantů"]
    idx["BundleIndex<br/>každé vyhledání, vyřešené jednou"]
    nav["Pravidla navigace<br/>další úprava této revize"]
    flt["Filtry a fulltextové hledání"]
    sel["Výběr a deep linky"]
  end

  subgraph frontend["Frontend — React + Vite"]
    direction TB
    render["Vykreslení runs<br/>zřetězení, nikdy offsety"]
    mode["Přepínač režimu<br/>clean / review / baseline"]
    timeline["Časová osa revizí<br/>+ navigace po kapitolách"]
    inspector["Inspektor<br/>co / kdy-kdo / proč"]
    keys["Klávesnice<br/>n p j k Escape"]
    hash["Deep linky<br/>#/edit #/revision #/comment"]
    print["Tisk / export do PDF"]
  end

  bundle[("bundle.json<br/>jeden generovaný soubor")]

  sources --> buildtime
  emit --> bundle
  bundle --> runtime
  runtime -->|"JSON přes HTTP"| frontend
  bundle -.->|"vložený, build --static"| frontend

  core -.->|"importuje"| buildtime
  core -.->|"importuje"| runtime
  core -.->|"importuje"| frontend

  classDef shared fill:#eef6ff,stroke:#2b6cb0,stroke-width:1px
  classDef store fill:#f7f7f7,stroke:#777,stroke-dasharray:3 3
  class core,zod,inv,idx,nav,flt,sel shared
  class bundle,git,changes,comments store
```

## Kdo co vlastní

| Oblast | Backend | `core` | Frontend | Proč právě tam |
| ------ | ------- | ------ | -------- | -------------- |
| Čtení gitu a souborů se záznamy | ano | ne | ne | Prohlížeč nemá souborový systém a zdrojem pravdy je repozitář |
| Rozhodnutí, která revize vyrobila který text | ano | ne | ne | Atribuce potřebuje celou historii; řeší se jednou, při buildu |
| Datový kontrakt | ne | ano | ne | Autorem je Zod, JSON Schema se z něj generuje, takže typy a schéma se nemohou rozejít |
| Validace invariantů | spouští ji | definuje ji | spouští ji | CLI validuje před zápisem, prohlížeč odmítne bundle, kterému nemůže věřit |
| „Další úprava této revize" | ne | ano | volá to | HTTP API, MCP nástroje i prohlížeč musí dát stejnou odpověď |
| Filtry a fulltextové hledání | ne | ano | volá to | Ze stejného důvodu; počet, který vidí čtenář, a počet, který hlásí asistent, je jedno číslo |
| Vykreslení runs do textu | ne | dodává pravidlo | ano | Zřetězení nesmazaných runs je celý renderer |
| Přepínač režimu, scrollování, klávesnice, tisk | ne | ne | ano | Rozhodnutí o čtení, bez vlivu na to, jaké změny nastaly |
| Formát deep linku | ne | ano | parsuje ho | Odkaz vložený do e-mailu musí po studeném startu otevřít totéž |
| Servírování SPA a bundle | ano | ne | ne | Lokálně, navázané na `127.0.0.1`; materiál je interní |
| Řízení nástroje z asistenta | ano (`--mcp`) | dodává odpovědi | ne | MCP rozhraní je projekcí `core`, ne druhou implementací |
| Otevření bundlu v editoru | extension čte soubor | validuje ho | vykreslí ho bez úprav | Editor je třetí hostitel téhož frontendu, ne druhý prohlížeč |

## Tři hostitelé, jeden frontend

Prohlížeč z `apps/web` běží na třech místech a je napsaný jednou:

| Hostitel | Odkud bere bundle | Co ho spustí |
| -------- | ----------------- | ------------ |
| Záložka prohlížeče | `GET /api/bundle`, kapitoly na vyžádání | `revlens serve` |
| Adresář, který se dá zazipovat | `bundle-data.js`, na globální proměnné | `revlens build --static` |
| Záložka editoru | tatáž globální proměnná, zapsaná do stránky | extension v `apps/vscode` |

Celý spoj je `detectSource()` v `apps/web/src/data/source.ts`: bundle na globální proměnné
vyhrává nad API. Vzniklo to, aby stránka z `file://` fungovala bez fetchování — a přesně to
je omezení, které má webview, takže prohlížeč se kvůli editoru nemusel měnit vůbec.

Ta extension je jedna pro dvě aplikace, Visual Studio Code a Pilot, protože Pilot spouští
skutečné `.vsix` extensiony na podmnožině API. Cesta k dokumentu používá jen to, co mají
oba hostitelé; cokoli nad ní se zjišťuje, nepředpokládá. Viz
[ADR-006](docs/adr/ADR-006-standalone-product-and-editor-extensions.md).

## Studený start deep linku

Odkaz na jednu změnu, vložený do e-mailu, musí tuto změnu otevřít ve stopadesátistránkovém
dokumentu, aniž by se dokument nejdřív celý načetl.

```mermaid
sequenceDiagram
  autonumber
  actor R as Čtenář
  participant B as Prohlížeč (SPA)
  participant C as core (v prohlížeči)
  participant S as Server (Fastify)

  R->>B: otevře .../#/edit/E-004
  B->>C: parseHash("#/edit/E-004")
  C-->>B: selection = edit E-004
  B->>S: GET /api/bundle
  Note right of S: metadata, časová osa, komentáře,<br/>index úprav — žádný text kapitol
  S-->>B: BundleSummary
  B->>C: resolveSelection(index, selection)
  C-->>B: edit, revize, komentáře, sourozenci, chapterId
  B->>S: GET /api/chapters/ch-02
  S-->>B: jedna kapitola s bloky a runs
  B->>R: kapitola vykreslena, pasáž zvýrazněna,<br/>inspektor otevřen, seznam sourozenců připraven
  R->>B: stiskne n
  B->>C: nextEditOfRevision(index, "E-004")
  C-->>B: E-005 (stejná revize, jiný blok)
  B->>R: odscrolluje k ní, výběr zůstává ukotven
```

## Rebuild řízený asistentem

S `--mcp` obsluhuje tentýž proces prohlížeč i asistenta, takže existuje jeden bundle
a jeden rebuild — žádná druhá kopie, která by mohla zastarat.

```mermaid
sequenceDiagram
  autonumber
  actor A as Asistent (MCP klient)
  participant M as MCP server (stdio)
  participant S as Stav serveru
  participant AD as adapters
  participant B as Prohlížeč

  A->>M: tools/call revlens_rebuild
  M->>S: rebuild()
  S->>AD: znovu spustí zdrojový adaptér
  AD-->>S: bundle + build report
  S->>S: validuje, vymění na místě, zvýší verzi
  S-->>M: report — úpravy, nevysvětlené, varování
  M-->>A: „7 úprav, 0 nevysvětlených"
  A->>M: tools/call revlens_comment {id: "K2-004"}
  M->>S: index.editsOfComment("K2-004")
  S-->>M: E-003 (ch-01), E-007 (ch-02)
  M-->>A: dvě změny, které komentář vyvolal
  B->>S: GET /api/bundle (při příštím obnovení)
  S-->>B: přestavěný bundle
  Note over M,B: stdout nese jen protokol —<br/>veškeré logování jde na stderr
```

## Proč bundle sedí uprostřed

```mermaid
flowchart LR
  subgraph expensive["Zaplaceno jednou, při buildu"]
    h["Celá git historie<br/>+ každý záznam"]
  end
  subgraph cheap["Zaplaceno při každém vykreslení"]
    v["Zřetězení runs"]
  end
  h -->|"token blame"| bundle[("bundle.json")]
  bundle -->|"žádné offsety k přepočtu"| v

  style bundle fill:#eef6ff,stroke:#2b6cb0
```

Všechno, co je těžké — projít historii, spárovat bloky napříč přepisy, nést atribuci dál
skrz pozdější úpravy — proběhne jednou a přistane v souboru. Všechno, co vyvolá čtenář,
je vyhledání v mapě nebo zřetězení řetězců. To je celý příběh o výkonu: nástroj je nad
stopadesátistránkovým dokumentem rychlý proto, že prohlížeč nikdy nedostal tu těžkou část.

---

**Vytvořeno**: 2026-09-16
**Poslední aktualizace**: 2026-09-16
