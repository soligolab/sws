const fs   = require("fs");
const path = require("path");

const base = path.resolve("sws-editor/public/images");
const cats = [
  { id: "mdi",        label: "Material Design Icons",       license: "Apache 2.0" },
  { id: "equinor",    label: "Equinor Engineering Symbols", license: "MIT" },
  { id: "tabler",     label: "Tabler Icons",                license: "MIT" },
  { id: "electrical", label: "Electrical Symbol Library",   license: "CC0" },
];

const catalog = {
  categories: cats.map(function(cat) {
    const dir = path.join(base, cat.id);
    let files = [];
    try { files = fs.readdirSync(dir).filter(function(f) { return f.endsWith(".svg"); }).sort(); }
    catch (_) {}
    return {
      id: cat.id,
      label: cat.label,
      license: cat.license,
      items: files.map(function(f) {
        return {
          id:    cat.id + "-" + path.basename(f, ".svg"),
          path:  "/images/" + cat.id + "/" + f,
          label: path.basename(f, ".svg").replace(/[-_]/g, " "),
        };
      }),
    };
  }),
};

fs.writeFileSync(path.join(base, "catalog.json"), JSON.stringify(catalog, null, 2));
var summary = catalog.categories.map(function(c) { return c.id + ": " + c.items.length; }).join(", ");
console.log("catalog.json written —", summary);
