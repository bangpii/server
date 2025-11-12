import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(cors());
app.use(express.json());

// Koneksi MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Atlas Connected"))
.catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Route dasar
app.get("/", (req, res) => {
  res.send("🚀 Server PiiCloud terkoneksi dengan MongoDB Atlas!");
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`🌍 Server berjalan di port ${PORT}`);
});
