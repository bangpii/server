import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Koneksi MongoDB
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB Atlas Connected"))
.catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Schema untuk File Metadata
const fileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  size: { type: Number, required: true },
  mimetype: { type: String, required: true },
  userId: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
  downloadUrl: { type: String, required: true },
  filePath: { type: String, required: true }
});

const File = mongoose.model('File', fileSchema);

// Konfigurasi Multer untuk file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Terima semua jenis file
    cb(null, true);
  }
});

// Routes
app.get("/", (req, res) => {
  res.send("🚀 Server PiiCloud terkoneksi dengan MongoDB Atlas!");
});

// Upload file
app.post("/upload", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${baseUrl}/uploads/${req.file.filename}`;

    const fileData = new File({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      userId: userId,
      downloadUrl: downloadUrl,
      filePath: req.file.path
    });

    await fileData.save();

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileData._id,
        filename: fileData.originalName,
        size: fileData.size,
        mimetype: fileData.mimetype,
        downloadUrl: fileData.downloadUrl,
        uploadDate: fileData.uploadDate
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all files by user
app.get("/files/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const files = await File.find({ userId: userId }).sort({ uploadDate: -1 });

    res.json({
      files: files.map(file => ({
        id: file._id,
        filename: file.originalName,
        size: file.size,
        mimetype: file.mimetype,
        downloadUrl: file.downloadUrl,
        uploadDate: file.uploadDate
      }))
    });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download file
app.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(file.filePath, file.originalName);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete file
app.delete("/files/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Hapus file dari filesystem
    if (fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath);
    }

    // Hapus dari database
    await File.findByIdAndDelete(fileId);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`🌍 Server berjalan di port ${PORT}`);
  console.log(`📁 Upload directory: ${path.join(__dirname, 'uploads')}`);
});