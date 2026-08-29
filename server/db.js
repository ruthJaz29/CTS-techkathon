/**
 * db.js
 * ------------------------------------------------------------------
 * A deliberately simple "database". For this MVP we store everything
 * in one JSON file (data/db.json) and read/write it with plain fs
 * calls. This stands in for the MongoDB shown in the architecture
 * diagram — the shape of the data (patients, doctors, consultations,
 * appointments) is the same, so swapping this file for a real
 * MongoDB/Mongoose layer later is a drop-in replacement, not a
 * redesign.
 *
 * Every function below reads the whole file, mutates the in-memory
 * object, then writes the whole file back. That's O(file size) per
 * call, which is fine for a hackathon MVP with a handful of records
 * and NOT fine for production — call that out if you're asked about
 * scaling.
 * ------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function readDb() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

module.exports = { readDb, writeDb, newId };
