---
audience: human
language: cs
translation-of: SKILL.md
disable-model-invocation: true
user-invocable: false
description: 'Czech translation of SKILL.md for human readers. NOT a skill - agents must not read or execute this file; the source of truth is SKILL.md in the same directory.'
---

# Implement Issue (česky)

> **Poznámka:** Tento soubor **nečte agent** — je určen pro uživatele, který čte
> česky. Zdrojem pravdy je anglická verze [`SKILL.md`](SKILL.md). Při změně
> anglické verze aktualizuj i tento překlad.

Workflow pro implementaci interního issue - od přečtení zadání přes vytvoření branch, implementaci kódu, commit až po přípravu PR popisu.

## Kontext

- Komunikace s uživatelem probíhá **česky**, kód, komentáře a commit messages **anglicky**.
- Tento workflow vyžaduje aktivní roli **Developer**.

## KRITICKÉ PRAVIDLO

**NIKDY nepřidávej "Co-Authored-By: Claude" do git commitů ani do kódu.** Žádná AI atribuce není vyžadována.

## KROK 0: Kontrola role

Zkontroluj aktuální roli v `CLAUDE.local.md`. Pokud role není **Developer**:

1. Informuj uživatele, že implementace vyžaduje roli Developer
2. Nabídni přepnutí role příkazem `/role developer`
3. **STOP** - Nepokračuj dokud není role Developer aktivní

## KROK 1: Získej issue

Zeptej se mě na název nebo ID interního issue. Počkej na mou odpověď.

## KROK 2: Potvrzení porozumění

Poté, co ti poskytnu issue:

1. Přečti soubor issue z `docs/issues/`
2. Přeformuluj issue vlastními slovy **česky**
3. Vysvětli potřebné změny v kódu **česky**
4. Požádej mě o potvrzení

**STOP** - Počkej na mé výslovné potvrzení než budeš pokračovat.

## KROK 3: Vytvoř branch

Vytvoř git branch: `feature/<issue-id>-<kratky-popis>` nebo `fix/<issue-id>-<kratky-popis>`

- Použij malá písmena a pomlčky pro popis
- Příklad: `feature/042-add-export-api`

Zobraz git příkaz před jeho spuštěním.

## KROK 4: Implementace

- Proveď všechny změny kódu v jedné souvislé fázi
- NEPTEJ se na otázky, pokud to není skutečně nejednoznačné
- Modifikuj pouze relevantní soubory
- Dodržuj coding style projektu

Na konci poskytni shrnutí:

- Modifikované soubory
- Přidané metody/třídy
- Odstraněný kód
- Klíčová rozhodnutí

Zeptej se mě, co chci:

- a) Přijmout tak jak je
- b) Upravit konkrétní části
- c) Předělat kompletně

**STOP** - Počkej na mé schválení než budeš pokračovat.

## KROK 4b: Zvýšení verze

Po implementaci před testováním navrhni zvýšení patch verze v `package.json`:

- Aktuální verze: `X.Y.Z`
- Navrhovaná verze: `X.Y.(Z+1)`

**STOP** - Počkej na schválení před úpravou verze.

## KROK 5: Commit

Připrav commit message:

```text
<type>(<issue-id>): <krátké shrnutí>

- klíčová změna 1
- klíčová změna 2
```

Povolené typy: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

**STOP** - Zeptej se mě na potvrzení commit message před commitnutím.

## Další kroky

Po dokončení implementace použij `/finish-branch` pro:

- Merge branch do hlavní větve
- Smazání feature branch
- Aktualizaci stavu issue na ✅ Implemented
