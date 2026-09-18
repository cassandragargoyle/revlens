/**
 * UI strings, in Czech, in one place.
 *
 * The readers are the engagement team and the client, so the interface is Czech. Code,
 * identifiers, comments and documentation stay English per the repository rules - this
 * module is the seam between the two.
 */
export const cs = {
  appTitle: 'RevLens',

  mode: {
    label: 'Zobrazení',
    clean: 'Čistopis',
    review: 'Se změnami',
    baseline: 'Původní verze',
    cleanHint: 'Finální text, jak ho čtenář dostane',
    reviewHint: 'Vložený text podtržený, smazaný přeškrtnutý',
    baselineHint: 'Text ve znění, které dostali recenzenti',
  },

  rail: {
    label: 'Hlavní volby',
    expand: 'Rozbalit popisky',
    collapse: 'Sbalit popisky',
    rebuild: 'Přegenerovat',
    rebuildHint: 'Postavit bundle znovu z aktuálních záznamů',
  },

  chapters: {
    heading: 'Kapitoly',
    changes: (count: number): string =>
      count === 0
        ? 'beze změn'
        : count === 1
          ? '1 změna'
          : count < 5
            ? `${count} změny`
            : `${count} změn`,
    untouched: 'Beze změn',
  },

  timeline: {
    heading: 'Revize',
    empty: 'Žádná revize neodpovídá filtru.',
    edits: (count: number): string =>
      count === 1 ? '1 změna' : count < 5 ? `${count} změny` : `${count} změn`,
    kind: {
      instruction: 'pokyn',
      'comment-resolution': 'vypořádání připomínky',
      merge: 'sloučení',
      editorial: 'redakční úprava',
      unknown: 'bez záznamu',
    } as Record<string, string>,
    clearSelection: 'Zrušit výběr',
  },

  about: {
    open: 'O nástroji',
    close: 'Zpět k dokumentu',
    title: 'RevLens — čtení revidovaného dokumentu',
    lead:
      'Ukazuje finální text tak, jak ho čtenář dostane, a v něm vyznačené každé místo, které se od porovnávané verze změnilo. U každé změny odpovídá na tři otázky: co se změnilo, kdy a kdo to způsobil, a na základě které připomínky.',
    // The cover is not decoration: it shows the one thing the tool exists for.
    coverAlt:
      'Stránka dokumentu se třemi vyznačenými místy; ze všech tří vedou linky do jednoho uzlu na časové ose revizí.',
    coverCaption:
      'Jeden uzel na časové ose, tři linky, tři vyznačená místa v textu. Přesně tohle nástroj umí: jeden pokyn obvykle dopadne na několik míst a čte se jako jeden krok, ne jako roztroušené úpravy.',

    reading: 'Jak dokument číst',
    readingModes:
      'Přepínač v levé liště mění, co je vidět: Čistopis je finální text, Se změnami podtrhává vložené a přeškrtává odstraněné, Původní verze ukazuje znění, které dostali recenzenti.',
    readingClick:
      'Kliknutí na vyznačené místo otevře rozbor vpravo. Odtud se klávesou n skáče na další změnu téže revize — i do jiné kapitoly.',

    gates: 'Tři brány, kterými připomínka prochází',
    gatesLead:
      'Odpovídají na různé otázky a mohou si odporovat. Připomínka může být potvrzená, přijatá — a pořád nezapracovaná.',
    gateVerdict: 'Je námitka věcně správná?',
    gateDecision: 'Co jsme se rozhodli udělat?',
    gateResolution: 'Je to skutečně zapracované v textu?',
    gatesOutstanding:
      'Připomínka, která se v textu neprojevila, se přes dokument najít nedá — v dokumentu z definice není. Proto je seznam připomínek samostatný.',

    ids: 'Odkazy a trvanlivost',
    idsLead:
      'Výběr je adresovatelný a odkaz se dá vložit do e-mailu. Ne všechno ale přežije přegenerování bundlu:',
    idsDurable: 'přežije přegenerování i změnu porovnávané verze',
    idsVolatile: 'platí jen uvnitř jednoho bundlu',

    provenance: 'Co je právě načtené',
    document: 'Dokument',
    version: 'Verze',
    baseline: 'Porovnáno proti',
    generated: 'Sestaveno',
    generator: 'Čím',
    unknownGenerator: 'neuvedeno',
    tool: 'Verze nástroje',
    totals: 'Rozsah',
    totalsValue: (chapters: number, blocks: number): string =>
      `${chapters} kapitol, ${blocks} bloků`,
    changes: 'Změn',
    revisions: 'Revizí',
    commentCount: 'Připomínek',
    unexplained: 'Bez doloženého původu',
    unexplainedHint:
      'Změny, u kterých se nepodařilo dohledat záznam, který je vysvětluje. Číslo se ukazuje i když je nula — report, který mlčí, když je vše v pořádku, nejde odlišit od reportu, který mlčí protože se neptal.',
  },

  layout: {
    resizeHint: 'Táhnutím změníte šířku, šipkami po krocích, dvojklikem zpět na výchozí',
    resizeLeft: 'Šířka levého panelu',
    resizeRight: 'Šířka pravého panelu',
  },

  views: {
    chapters: 'Kapitoly',
    revisions: 'Revize',
    comments: 'Připomínky',
  },

  comments: {
    heading: 'Připomínky',
    empty: 'Žádná připomínka neodpovídá filtru.',
    none: 'Tento dokument nemá evidované připomínky.',
    count: (shown: number, total: number): string =>
      `Zobrazeno ${shown} ze ${total} připomínek`,
    // The three gates the records take a comment through. They answer different
    // questions and can disagree, so each has its own label and its own filter.
    verdict: 'Ověření',
    decision: 'Rozhodnutí',
    resolution: 'Vypořádání',
    landed: 'V textu',
    landedYes: 'promítnuto do textu',
    landedNo: 'v textu se neprojevilo',
    // "Nothing in the text" alone is not the open list: it also catches everything worked
    // in before the compared version, which cannot show up here by construction.
    onlyOutstanding: 'Jen nezapracované v tomto rozsahu',
    onlyOutstandingHint:
      'Vynechá připomínky vypořádané ještě před porovnávanou verzí — ty se v tomhle srovnání objevit nemohou, jejich změny jsou uvnitř výchozího textu.',
    // Deliberately not "už zapracováno": a comment can be closed as declined, as no longer
    // applicable, or as an umbrella split into others, and none of those put anything in
    // the text.
    beforeBaseline: 'mimo rozsah srovnání',
    beforeBaselineHint:
      'Uzavřeno dřív, než porovnávaná verze začíná. Do tohohle srovnání nepatří — což neříká, že se to promítlo do textu.',
    scopeToggle: 'Ukázat i připomínky uzavřené dřív',
    scopeHint: (hidden: number): string =>
      hidden === 1
        ? '1 připomínka je uzavřená dřív, než porovnávaná verze začíná.'
        : `${hidden} připomínek je uzavřených dřív, než porovnávaná verze začíná.`,
    countScoped: (shown: number, inRange: number, total: number): string =>
      `Zobrazeno ${shown} z ${inRange} připomínek k tomuto srovnání (v bundlu jich je ${total})`,
    outOfScopeTitle: 'Mimo rozsah tohoto srovnání',
    outOfScopeWhy:
      'Tahle připomínka byla uzavřená dřív, než porovnávaná verze začíná, takže se v tomhle srovnání projevit nemohla. Co s ní bylo, říkají rozhodnutí a vypořádání výše — uzavřená neznamená zapracovaná.',
    changes: 'Zapsané vypořádání',
    noChange: 'Tato připomínka nezměnila v dokumentu žádné místo.',
    noChangeWhy:
      'Buď se ještě nezapracovala, nebo byla zamítnuta, nebo odpadla. Rozhodnutí a vypořádání výše říkají které.',
    noChangeBefore:
      'Vypořádala se ještě před porovnávanou verzí, takže její změny jsou uvnitř výchozího textu. V tomhle srovnání se objevit nemohou.',
    producedChanges: (count: number): string =>
      count === 1 ? 'Změnila 1 místo v dokumentu' : `Změnila ${count} míst v dokumentu`,
  },

  filters: {
    heading: 'Filtr',
    search: 'Hledat v pokynech a připomínkách',
    searchPlaceholder: 'např. CTO, PLAN, K2-004',
    author: 'Autor',
    round: 'Kolo připomínek',
    from: 'Od',
    to: 'Do',
    reset: 'Zrušit filtr',
    visible: (shown: number, total: number): string =>
      `Zobrazeno ${shown} z ${total} změn`,
    none: 'Filtru neodpovídá žádná změna.',
  },

  inspector: {
    heading: 'Rozbor změny',
    empty: 'Vyberte vyznačené místo v textu, nebo revizi v levém sloupci.',
    what: 'Co se změnilo',
    inserted: 'Vloženo',
    removed: 'Odstraněno',
    wholeBlockAdded: 'Celý odstavec je nový',
    wholeBlockRemoved: 'Celý odstavec byl odstraněn',
    whenWho: 'Kdy a kdo',
    instruction: 'Pokyn',
    why: 'Proč',
    comment: 'Připomínka',
    commentAuthor: 'Připomínkující',
    decision: 'Rozhodnutí',
    answer: 'Odpověď recenzentovi',
    verdict: 'Ověření',
    noComment: 'Tato změna nevychází z připomínky.',
    siblings: 'Další změny téže revize',
    siblingsHint: 'Jeden pokyn dopadl na víc míst v dokumentu.',
    onlyChange: 'Tato revize změnila jen toto jedno místo.',
    position: (position: number, total: number): string => `${position} z ${total}`,
    openSource: 'Zdroj záznamu',
    chapters: 'Zasažené kapitoly',
    chaptersHint: 'Jedna revize běžně zasáhne víc kapitol; kliknutím skočíte na první změnu v dané kapitole.',
    chapterShare: (count: number): string =>
      count === 1 ? '1 změna' : count < 5 ? count + ' změny' : count + ' změn',
    copyLink: 'Kopírovat odkaz',
    copied: 'Odkaz zkopírován',
    chapter: 'Kapitola',
  },

  keyboard: {
    heading: 'Klávesy',
    nextSibling: 'n — další změna téže revize',
    previousSibling: 'p — předchozí změna téže revize',
    nextEdit: 'j — další změna v dokumentu',
    previousEdit: 'k — předchozí změna v dokumentu',
    escape: 'Esc — zrušit výběr',
    print: 'Tisk / PDF',
  },

  status: {
    loading: 'Načítám…',
    error: 'Nepodařilo se načíst data',
    retry: 'Zkusit znovu',
    unresolved: (id: string): string => `Odkaz míří na ${id}, který v tomto dokumentu není.`,
    baseline: (version: string): string => `proti verzi ${version}`,
    generated: (at: string): string => `sestaveno ${at}`,
    unexplained: (count: number): string =>
      count === 0
        ? 'Všechny změny mají doložený původ.'
        : `${count} změn nemá doložený původ.`,
  },
} as const;

export type Strings = typeof cs;
