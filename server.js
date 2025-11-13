// server/server.js
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ES6 module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Inisialisasi Firebase Admin
let db;
try {
  // Coba gunakan file JSON langsung
  const serviceAccountPath = './cloudpii-99f31-firebase-adminsdk-fbsvc-e9c3018f3e.json';
  
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized from JSON file');
  } else {
    // Fallback ke environment variables
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized from environment variables');
  }
  
  db = admin.firestore();
  console.log('✅ Firestore connected successfully');
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error);
  console.log('🔄 Server will run without Firebase connection');
}

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
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  }
});

// Helper functions
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype === 'application/pdf') return 'pdf';
  if (mimetype.includes('document') || mimetype.includes('word')) return 'document';
  if (mimetype.includes('spreadsheet') || mimetype.includes('excel')) return 'spreadsheet';
  if (mimetype.includes('zip') || mimetype.includes('compressed')) return 'archive';
  if (mimetype.includes('text')) return 'text';
  return 'file';
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'CloudPii Server is running',
    timestamp: new Date().toISOString(),
    port: PORT,
    firebase: db ? 'connected' : 'disabled',
    base_url: process.env.BASE_URL
  });
});

// Upload file endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('📤 Upload request received');
    
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded' 
      });
    }

    const { userId, userEmail, fileName } = req.body;
    
    console.log('📝 Upload data:', {
      userId,
      userEmail,
      fileName,
      originalName: req.file.originalname,
      uploadedFile: req.file.filename,
      fileSize: req.file.size
    });

    if (!userId || !userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID and email are required' 
      });
    }

    // Generate user document name dari email
    const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
    
    // File information
    const fileData = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: fileName || req.file.originalname,
      originalName: req.file.originalname,
      pemilik: userEmail,
      tanggal: new Date().toISOString(),
      size: formatFileSize(req.file.size),
      type: getFileType(req.file.mimetype),
      fileUrl: `${process.env.BASE_URL}/uploads/${req.file.filename}`,
      serverFilename: req.file.filename,
      mimeType: req.file.mimetype,
      userId: userId,
      uploadedAt: new Date().toISOString(),
    };

    console.log('💾 Saving to Firebase:', fileData);

    // Simpan ke Firebase Firestore jika tersedia
    if (db) {
      try {
        await db
          .collection('cloudpii')
          .doc(userDocName)
          .collection('files')
          .doc(fileData.id)
          .set({
            ...fileData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        console.log(`✅ File saved to Firebase: ${fileData.name}`);
      } catch (firebaseError) {
        console.error('❌ Firebase save error:', firebaseError);
        return res.status(500).json({
          success: false,
          error: 'Failed to save file to database',
          details: firebaseError.message
        });
      }
    } else {
      return res.status(500).json({
        success: false,
        error: 'Database not available'
      });
    }

    console.log(`✅ File uploaded successfully for user ${userEmail}: ${fileData.name}`);

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      file: fileData
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Get user files
app.get('/api/files/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userEmail = req.query.email;

    console.log('📥 Get files request:', { userId, userEmail });

    if (!userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'User email is required' 
      });
    }

    let files = [];

    if (db) {
      const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
      const snapshot = await db
        .collection('cloudpii')
        .doc(userDocName)
        .collection('files')
        .orderBy('createdAt', 'desc')
        .get();

      files = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    console.log(`📁 Found ${files.length} files for user ${userEmail}`);

    res.json({
      success: true,
      files: files
    });

  } catch (error) {
    console.error('❌ Get files error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Get all files (for testing)
app.get('/api/files', async (req, res) => {
  try {
    console.log('📥 Get all files request');
    
    let files = [];

    if (db) {
      const snapshot = await db
        .collectionGroup('files')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      files = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    console.log(`📁 Found ${files.length} total files`);

    res.json({
      success: true,
      files: files
    });

  } catch (error) {
    console.error('❌ Get all files error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Delete file
app.delete('/api/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { userEmail } = req.body;

    console.log('🗑️ Delete file request:', { fileId, userEmail });

    if (!userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'User email is required' 
      });
    }

    if (db) {
      const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
      await db
        .collection('cloudpii')
        .doc(userDocName)
        .collection('files')
        .doc(fileId)
        .delete();
    }

    console.log(`✅ File ${fileId} deleted successfully`);

    res.json({ 
      success: true, 
      message: 'File deleted successfully' 
    });

  } catch (error) {
    console.error('❌ Delete file error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Download file
app.get('/api/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    console.log('📥 Download request:', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        success: false,
        error: 'File not found' 
      });
    }

    res.download(filePath, (err) => {
      if (err) {
        console.error('❌ Download error:', err);
        res.status(500).json({ 
          success: false,
          error: 'Download failed' 
        });
      }
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Get server info
app.get('/api/info', (req, res) => {
  res.json({
    name: 'CloudPii Server',
    version: '1.0.0',
    status: 'running',
    firebase: db ? 'connected' : 'disabled',
    upload_dir: path.join(__dirname, 'uploads'),
    base_url: process.env.BASE_URL,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is working!',
    timestamp: new Date().toISOString()
  });
});

// 404 handler - FIXED: Gunakan approach yang benar untuk Express 4
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl 
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Server error:', error);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: error.message 
  });
});

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 CloudPii Server berjalan di port ${PORT}`);
  console.log(`📁 Upload directory: ${path.join(__dirname, 'uploads')}`);
  console.log(`🔗 Base URL: ${process.env.BASE_URL}`);
  console.log(`🔗 Health check: ${process.env.BASE_URL}/health`);
  console.log(`📤 Upload endpoint: ${process.env.BASE_URL}/api/upload`);
  console.log(`ℹ️  Server info: ${process.env.BASE_URL}/api/info`);
  console.log(`🔥 Firebase status: ${db ? 'CONNECTED ✅' : 'DISABLED ⚠️'}`);
  console.log('='.repeat(50));
});