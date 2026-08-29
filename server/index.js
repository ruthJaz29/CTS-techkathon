/**
 * index.js
 * ------------------------------------------------------------------
 * Entry point. Wires together:
 *   - dotenv        (loads .env so GEMINI_API_KEY etc. are available)
 *   - express.json  (parses JSON bodies)
 *   - static files  (serves the plain HTML/CSS/JS frontend from /public)
 *   - /api routes   (server/routes.js)
 *
 * There is no build step and no frontend framework - "public/" is
 * served as-is, which is why the frontend is plain HTML/CSS/JS as
 * requested for the MVP.
 * ------------------------------------------------------------------
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const apiRoutes = require("./routes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", apiRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"
    ),
  });
});

app.listen(PORT, () => {
  console.log(`\nMedScribe AI MVP running at http://localhost:${PORT}`);
  console.log(`Login page:            http://localhost:${PORT}/login.html\n`);
});
