# Third-party software notices

3DENA Next is distributed under GPL-3.0-only. The complete license text is in
[`LICENSE`](LICENSE). The production application includes the following direct
third-party dependencies; their own copyright notices and license files remain
in the corresponding npm packages.

| Package | Frozen version | Declared license | Project |
|---|---:|---|---|
| `jena-js` | 0.6.2 | GPL-3.0-only | <https://github.com/HUDongpin/jENA> |
| `lucide-react` | 1.33.0 | ISC | <https://lucide.dev> |
| `next` | 16.3.1 | MIT | <https://nextjs.org> |
| `papaparse` | 5.6.0 | MIT | <https://www.papaparse.com/> |
| `plotly.js` | 3.7.0 | MIT | <https://github.com/plotly/plotly.js> |
| `plotly.js-dist-min` | 3.7.0 | MIT | <https://github.com/plotly/plotly.js> |
| `react` | 19.2.4 | MIT | <https://react.dev> |
| `react-dom` | 19.2.4 | MIT | <https://react.dev> |
| `react-plotly.js` | 4.1.0 | MIT | <https://github.com/plotly/react-plotly.js> |

This inventory describes the direct production dependencies frozen in
`package-lock.json`. Transitive package license metadata is preserved in the
installed dependency graph and must be regenerated and reviewed for every
release artifact. No legacy application code or offline scientific-oracle
runtime is included in the production dependency graph merely by being present
in this migration repository.

The upstream `jena-js@0.6.2` package currently declares a self-dependency. This
repository freezes its npm tarball integrity and verifies that the installed
tree resolves exactly one deduplicated `jena-js@0.6.2`; a reviewed upstream
packaging successor remains a production-release gate.
