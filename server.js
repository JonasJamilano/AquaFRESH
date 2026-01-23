import express from "express";
import bcrypt from "bcrypt";
import cors from "cors";
import { db } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

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
  const { email, password } = req.body;

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
    fullName: user.full_name
  });
});

app.listen(3000, () => {
  console.log("✅ Server running on http://localhost:3000");
});