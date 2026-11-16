JOPLIN_PLUGINS_DIR ?= $(HOME)/.config/joplin-desktop/plugins

.PHONY: all build deps install update clean bump-version

all: build

## Install npm dependencies
deps:
	npm install

## Build dist/ and package publish/*.jpl
build:
	npm run dist

# Bump the patch version in manifest and package
bump-version:
	npm run updateVersion

## Build and copy the .jpl directly into Joplin's local plugins folder
install: build
	mkdir -p "$(JOPLIN_PLUGINS_DIR)"
	cp publish/*.jpl "$(JOPLIN_PLUGINS_DIR)/"
	@echo "Installed to $(JOPLIN_PLUGINS_DIR). Restart Joplin to load changes."

## Update the underlying Joplin plugin build framework
update:
	npm run update

## Remove build artifacts
clean:
	rm -rf dist publish
