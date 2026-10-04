# Run the model extraction tools

Run commands from the repository root. Extraction requires Node.js 18+ and a JDK 17+ with `java` and `jar` on `PATH`.

## Extract the Minecraft 1.16.5 dumps

Choose an output directory that does not exist:

```sh
node res/tools/java/extractModelDumps.js --output res/tools/java/generated/1.16.5
```

The command downloads the required client, libraries, and mapping tools, then writes `entityModels.json` and `blockEntityModels.json`. It compares both files with the repository's reference dictionaries and exits with code 1 if validation or comparison fails. The reference files are not overwritten.

Downloads are cached in `res/tools/java/.cache/1.16.5`. Use `--cache DIR` to choose another cache directory. After a successful download, repeat extraction without network access using a fresh output directory:

```sh
node res/tools/java/extractModelDumps.js --offline --output res/tools/java/generated/1.16.5-repeat
```

If remapping fails, check `remap-intermediary.log` or `remap-yarn.log` in the cache directory.

## Audit and compare dumps

Audit the repository's two reference dictionaries:

```sh
node res/tools/java/auditModelDumps.js
```

Add `--json` for detailed reports, or pass JSON file paths to audit other dumps. To compare the reference dictionaries with generated files of the same names, run:

```sh
node res/tools/java/auditModelDumps.js --compare res/tools/java/generated/1.16.5
```

Comparison ignores object key order and equivalent number formatting. Invalid files and mismatches return exit code 1. Empty models and intermediary names are reported without failing validation.

Both commands support `--help`.
