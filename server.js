import express from "express";
import bcrypt from "bcrypt";
import cors from "cors";
import { db } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

console.log("✅ server.js loaded");

/* =====================
   REGISTER
===================== */
app.post("/register", async (req, res) => {
  console.log("📩 REGISTER REQUEST BODY:", req.body);

  const { fullName, email, password, phone, address, role } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      `INSERT INTO users (full_name, email, password, phone, address, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fullName, email, hashedPassword, phone, address, role]
    );

    console.log("✅ INSERT RESULT:", result);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ DB ERROR:", err);
    res.status(400).json({ error: err.message });
  }
});

/* =====================
   LOGIN
===================== */
app.post("/login", async (req, res) => {
  console.log("➡️  POST /login hit");

  const { email, password } = req.body;

  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email = ? AND status = 'active'",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({
      id: user.id,
      role: user.role,
      fullName: user.full_name,
      email: user.email
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   GET USER PROFILE
   GET /users/:id
===================== */
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;
  console.log("➡️  GET /users/" + id + " hit");

  try {
    const [rows] = await db.execute(
      `SELECT id, full_name, email, phone, address, role, status, created_at
       FROM users
       WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      console.log("ℹ️  User not found with id:", id);
      return res.status(404).json({ error: "User not found" });
    }

    const user = rows[0];

    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      address: user.address,
      role: user.role,
      status: user.status,
      createdAt: user.created_at
    });
  } catch (err) {
    console.error("❌ GET USER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   UPDATE USER PROFILE
   PUT /users/:id
   (Updates: full_name, email, phone, address)
===================== */
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { fullName, email, phone, address } = req.body;

  console.log("➡️  PUT /users/" + id + " hit with body:", req.body);

  try {
    const [result] = await db.execute(
      `UPDATE users
       SET full_name = ?, email = ?, phone = ?, address = ?
       WHERE id = ?`,
      [fullName, email, phone, address, id]
    );

    if (result.affectedRows === 0) {
      console.log("ℹ️  No user updated for id:", id);
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      message: "Profile updated successfully"
    });
  } catch (err) {
    console.error("❌ UPDATE USER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   GET ALL USERS
===================== */
app.get("/users", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, full_name, email, phone, address, role, status, created_at
       FROM users
       ORDER BY id DESC`
    );

    res.json(rows);

  } catch (err) {
    console.error("❌ GET USERS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   UPDATE USER (ADMIN)
===================== */
app.put("/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  const { fullName, email, phone, address, role, status } = req.body;

  try {
    const [result] = await db.execute(
      `UPDATE users
       SET full_name = ?, 
           email = ?, 
           phone = ?, 
           address = ?, 
           role = ?, 
           status = ?
       WHERE id = ?`,
      [fullName, email, phone, address, role, status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ ADMIN UPDATE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   TOGGLE USER STATUS
===================== */
app.patch("/admin/users/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // active / inactive

  try {
    const [result] = await db.execute(
      `UPDATE users SET status = ? WHERE id = ?`,
      [status, id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("❌ STATUS UPDATE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   ADMIN CREATE USER
===================== */
app.post("/admin/users", async (req, res) => {
  const { fullName, email, password, phone, address, role, status } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.execute(
      `INSERT INTO users 
       (full_name, email, password, phone, address, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fullName, email, hashedPassword, phone, address, role, status]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("❌ ADMIN CREATE ERROR:", err);
    res.status(400).json({ error: err.message });
  }
});

/* =====================
   DELETE USER (ADMIN)
===================== */
app.delete("/admin/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.execute(
      "DELETE FROM users WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ DELETE USER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});


app.listen(3000, () => {
  console.log("🚀 Server with profile routes running on http://localhost:3000");
});
