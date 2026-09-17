# Build revlens and run it against an example.
#
# Everything here is a thin wrapper over the npm scripts and `scripts/`, so that the two
# cannot drift apart: `npm run build` and `npm test` stay the source of truth, and this
# file only adds the one thing they do not cover - turning an example's committed
# snapshots into a real git history and driving the CLI over it.
#
# Needs GNU make, Node 26.9+ (`.nvmrc`) and git on the PATH. On Windows, run it from Git Bash
# (`make demo`) or install make with `choco install make`.
#
# Override any of these on the command line:
#   make demo LANGUAGE=cs PORT=5000

EXAMPLE  ?= examples/01-revision-round
OUT      ?= out/example

# `LANGUAGE` is also a locale variable the desktop exports - empty on GNOME, `cs_CZ:en`
# elsewhere - and make's `?=` never overrides the environment, so `?= en` would not hold.
# Take the inherited value only when it names a language the example has; an assignment on
# the command line still wins over this one, so `make demo LANGUAGE=cs` works.
LANGUAGE := $(if $(wildcard $(EXAMPLE)/$(strip $(LANGUAGE))/history/history.json),$(strip $(LANGUAGE)),en)
PORT     ?= 4173
HOST     ?= 127.0.0.1

RECORDS = $(EXAMPLE)/$(LANGUAGE)
REPO    = $(OUT)/analysis-repo
BUNDLE  = $(OUT)/bundle.json
REPORT  = $(OUT)/report.json
STATIC  = $(OUT)/static

NPM     = npm run --silent
REVLENS = $(NPM) revlens --

.DEFAULT_GOAL := help
.PHONY: help install build seed bundle validate contracts report static serve demo debug check clean

help: ## Show this help
	@echo "revlens - build the tool and run it against an example"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sed -e 's/:.*## /|/' | awk -F'|' '{printf "  %-10s %s\n", $$1, $$2}'
	@echo ""
	@echo "Settings:"
	@echo "  EXAMPLE  = $(EXAMPLE)"
	@echo "  LANGUAGE = $(LANGUAGE)   (the example is written in en and cs)"
	@echo "  OUT      = $(OUT)"
	@echo "  PORT     = $(PORT)"

install: ## Install the workspace dependencies
	npm install

# Installed once, not re-installed because package.json is newer: `npm install` is the
# user's call, and a target that quietly re-resolves the tree turns a build into one.
node_modules:
	npm install

build: node_modules ## Compile everything - TypeScript, the schema, the viewer, the extension
	npm run build

seed: node_modules ## Replay the example's snapshots into a real git repository under out/
	@echo "seeding $(REPO) from $(RECORDS)"
	@$(NPM) example:seed -- --example $(EXAMPLE) --language $(LANGUAGE) --out $(REPO)

bundle: seed ## Build the bundle from the seeded repository and the example's records
	@$(REVLENS) build \
		--source engagement \
		--repo $(REPO) \
		--records $(RECORDS) \
		--from baseline \
		--to HEAD \
		--out $(BUNDLE) \
		--report $(REPORT)

validate: ## Check the built bundle against the schema and the invariants
	@$(REVLENS) validate $(BUNDLE)

contracts: node_modules ## Check the examples' records against schema/records
	@$(NPM) example:check

report: ## Print the build report of the last build
	@cat $(REPORT)

static: build bundle ## Write a self-contained copy of the viewer that needs no server
	@$(REVLENS) build \
		--source engagement \
		--repo $(REPO) \
		--records $(RECORDS) \
		--from baseline \
		--out $(BUNDLE) \
		--static $(STATIC)
	@echo "open $(STATIC)/index.html"

serve: ## Serve the built bundle and the viewer on the loopback interface
	@$(REVLENS) serve $(BUNDLE) --host $(HOST) --port $(PORT)

demo: build contracts bundle validate serve ## Everything: compile, build the example, open the viewer

# The same demo for the other target of the same viewer. The extension opens a file
# rather than a URL, so this one stops before `serve` and writes `$(OUT)/example.revlens`.
# Pressing F5 in Visual Studio Code runs the same script and attaches the debugger; this
# target is the quick look, without one.
debug: node_modules ## The example in an Extension Development Host, no debugger attached
	@$(NPM) demo:vscode -- --example $(EXAMPLE) --language $(LANGUAGE) --out $(OUT) --open

check: node_modules ## What has to pass before anything is reported as done
	npm run lint
	npm run typecheck
	npm run schema:check
	npm test

clean: ## Remove what the example produced; the workspace build is left alone
	@echo "removing $(OUT)"
	@rm -rf $(OUT)
