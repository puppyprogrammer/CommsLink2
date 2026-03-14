const fs = require("fs");
const pts = JSON.parse(fs.readFileSync("scripts/hologram_body.json", "utf8"));
const json = JSON.stringify(pts);
const escaped = json.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const sql = "UPDATE hologram_avatar SET points = '" + escaped + "' WHERE id = (SELECT id FROM (SELECT id FROM hologram_avatar LIMIT 1) t);";
fs.writeFileSync("scripts/update_avatar_points.sql", sql);
console.log("SQL size:", (sql.length / 1024).toFixed(1), "KB");
console.log("Points:", pts.length);
