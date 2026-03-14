const fs = require("fs");

// Points
const pts = JSON.parse(fs.readFileSync("scripts/hologram_body.json", "utf8"));
const ptsJson = JSON.stringify(pts);
const ptsEscaped = ptsJson.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// Skeleton (v2 proportions — must match generateHologramBody.ts)
const skeleton = [
  { id: "root", position: [0, 0, 0], parent_id: null },
  { id: "spine", position: [0, 0.20, 0], parent_id: "root" },
  { id: "chest", position: [0, 0.18, 0], parent_id: "spine" },
  { id: "neck", position: [0, 0.10, 0], parent_id: "chest" },
  { id: "head", position: [0, 0.10, 0], parent_id: "neck" },
  { id: "l_shoulder", position: [-0.15, 0, 0], parent_id: "chest" },
  { id: "l_elbow", position: [0, -0.16, 0], parent_id: "l_shoulder" },
  { id: "l_hand", position: [0, -0.14, 0], parent_id: "l_elbow" },
  { id: "r_shoulder", position: [0.15, 0, 0], parent_id: "chest" },
  { id: "r_elbow", position: [0, -0.16, 0], parent_id: "r_shoulder" },
  { id: "r_hand", position: [0, -0.14, 0], parent_id: "r_elbow" },
  { id: "l_hip", position: [-0.1, 0, 0], parent_id: "root" },
  { id: "l_knee", position: [0, -0.36, 0], parent_id: "l_hip" },
  { id: "l_foot", position: [0, -0.34, 0], parent_id: "l_knee" },
  { id: "r_hip", position: [0.1, 0, 0], parent_id: "root" },
  { id: "r_knee", position: [0, -0.36, 0], parent_id: "r_hip" },
  { id: "r_foot", position: [0, -0.34, 0], parent_id: "r_knee" },
];
const skelJson = JSON.stringify(skeleton);
const skelEscaped = skelJson.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const sql = "UPDATE hologram_avatar SET skeleton = '" + skelEscaped + "', points = '" + ptsEscaped + "' WHERE id = (SELECT id FROM (SELECT id FROM hologram_avatar LIMIT 1) t);";
fs.writeFileSync("scripts/update_avatar_points.sql", sql);
console.log("SQL size:", (sql.length / 1024).toFixed(1), "KB");
console.log("Points:", pts.length);
console.log("Skeleton joints:", skeleton.length);
