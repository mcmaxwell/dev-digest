# Skill import examples

Files for demoing the **Skills → Add Skill → Import from file** flow (L02).

- `flaky-test-patterns.md` — a ready-to-import skill with YAML frontmatter
  (`name` / `description` / `type`). Upload it as-is on the Skills page: the
  server extracts the core, shows a preview, and only saves after you confirm.
  Imported skills land **disabled** with source `imported_file` — vet the body,
  then enable and attach it to an agent (it pairs with *Test Quality Reviewer*).

To demo the **archive** path, zip it up (any extra files are listed as skipped
in the preview and never read or executed):

```sh
cd docs/skills-examples
cp flaky-test-patterns.md SKILL.md
echo 'echo "this is never executed"' > install.sh
zip flaky-test-patterns.zip SKILL.md install.sh
rm SKILL.md install.sh
```

The preview will show the markdown core from `SKILL.md` and `install.sh` under
"skipped entries" — the trust story in one screen: a foreign skill is someone
else's instructions in your agent's prompt, so it arrives disabled, delimiter-
wrapped as untrusted data, and executable content is ignored outright.
