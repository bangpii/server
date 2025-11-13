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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static('uploads'));

// Inisialisasi Firebase Admin dengan Base64
let db = null;
let firebaseInitialized = false;

const initializeFirebase = async () => {
  try {
    console.log('🔄 Initializing Firebase Admin...');

    // Check if Base64 credentials exist
    if (!process.env.FIREBASE_CREDENTIALS_B64) {
      throw new Error('FIREBASE_CREDENTIALS_B64 environment variable is missing');
    }

    console.log('🔧 Firebase Config:');
    console.log('   - Using Base64 credentials');
    console.log('   - Base64 length:', process.env.FIREBASE_CREDENTIALS_B64.length);

    // Decode Base64 credentials
    const credentialsJson = Buffer.from(process.env.FIREBASE_CREDENTIALS_B64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(credentialsJson);

    console.log('   - Project ID:', serviceAccount.project_id);
    console.log('   - Client Email:', serviceAccount.client_email);
    console.log('   - Private Key Length:', serviceAccount.private_key?.length || 0);

    // Validate private key format
    if (!serviceAccount.private_key || !serviceAccount.private_key.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Invalid private key format in service account');
    }

    // Initialize Firebase Admin
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      console.log('   - Firebase app initialized');
    } else {
      console.log('   - Firebase app already initialized');
    }
    
    db = admin.firestore();
    console.log('   - Firestore instance created');
    
    // Test connection dengan operasi sederhana
    console.log('🧪 Testing Firebase connection...');
    
    const testRef = db.collection('server_tests').doc('connection_test');
    const testData = {
      timestamp: new Date().toISOString(),
      message: 'Firebase connection test from server',
      status: 'testing'
    };

    // Test write operation
    await testRef.set(testData);
    console.log('   - Write test: ✅ SUCCESS');

    // Test read operation
    const docSnapshot = await testRef.get();
    if (docSnapshot.exists) {
      console.log('   - Read test: ✅ SUCCESS');
      
      // Update with success status
      await testRef.update({
        status: 'connected',
        connectedAt: new Date().toISOString()
      });
      
      firebaseInitialized = true;
      console.log('✅ Firebase Admin & Firestore initialized successfully');
      console.log('🔥 Firebase Status: FULLY OPERATIONAL');
      
    } else {
      throw new Error('Firebase read test failed - document not found');
    }
    
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message);
    
    // Detailed error information
    if (error.message.includes('UNAUTHENTICATED')) {
      console.error('🔐 Authentication failed. Issues:');
      console.error('   1. Service account credentials invalid');
      console.error('   2. Project ID mismatch');
      console.error('   3. Service account disabled');
      console.error('   4. Incorrect permissions');
    }
    
    if (error.message.includes('JSON')) {
      console.error('🔧 JSON parsing error - check Base64 format');
    }
    
    console.log('🔄 Server will run without Firebase connection');
    firebaseInitialized = false;
    db = null;
  }
};

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

// ==================== ROUTES ====================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'CloudPii Server is running',
    timestamp: new Date().toISOString(),
    port: PORT,
    firebase: firebaseInitialized ? 'connected' : 'disabled',
    base_url: process.env.BASE_URL,
    environment: process.env.NODE_ENV
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
      userId: userId || 'not provided',
      userEmail: userEmail || 'not provided',
      fileName: fileName || 'not provided',
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    if (!userId || !userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID and email are required' 
      });
    }

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

    let firebaseSaveSuccess = false;
    let firebaseError = null;

    // Simpan ke Firebase jika tersedia
    if (firebaseInitialized && db) {
      try {
        const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
        
        console.log('💾 Saving to Firebase...');
        console.log('   - Collection: cloudpii/' + userDocName + '/files');
        console.log('   - Document ID:', fileData.id);
        
        await db
          .collection('cloudpii')
          .doc(userDocName)
          .collection('files')
          .doc(fileData.id)
          .set({
            ...fileData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        
        firebaseSaveSuccess = true;
        console.log(`✅ File saved to Firebase: ${fileData.name}`);
        
      } catch (error) {
        firebaseError = error.message;
        console.error('❌ Firebase save error:', error.message);
        console.error('🔧 Firebase error details:', error);
      }
    } else {
      console.log('ℹ️  Firebase not available, saving file locally only');
    }

    console.log(`✅ File uploaded successfully: ${fileData.name}`);

    // Response based on Firebase status
    if (firebaseSaveSuccess) {
      res.status(201).json({
        success: true,
        message: 'File uploaded successfully to Firebase',
        file: fileData,
        storage: 'firebase'
      });
    } else if (firebaseError) {
      res.status(201).json({
        success: true,
        message: 'File uploaded locally (Firebase failed)',
        file: fileData,
        storage: 'local',
        warning: 'Firebase save failed: ' + firebaseError
      });
    } else {
      res.status(201).json({
        success: true,
        message: 'File uploaded locally',
        file: fileData,
        storage: 'local'
      });
    }

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
    let source = 'none';

    if (firebaseInitialized && db) {
      try {
        const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
        console.log('🔍 Querying Firebase for user:', userDocName);
        
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

        source = 'firebase';
        console.log(`📁 Found ${files.length} files from Firebase for user ${userEmail}`);
        
      } catch (firebaseError) {
        console.error('❌ Firebase query error:', firebaseError.message);
        files = [];
        source = 'error';
      }
    } else {
      console.log('ℹ️  Firebase not available, returning empty file list');
      source = 'unavailable';
    }

    res.json({
      success: true,
      files: files,
      source: source,
      count: files.length
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
    let source = 'none';

    if (firebaseInitialized && db) {
      try {
        const snapshot = await db
          .collectionGroup('files')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        files = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        source = 'firebase';
      } catch (firebaseError) {
        console.error('❌ Firebase query error:', firebaseError.message);
        files = [];
        source = 'error';
      }
    }

    console.log(`📁 Found ${files.length} total files from ${source}`);

    res.json({
      success: true,
      files: files,
      source: source,
      count: files.length
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

    let deletedFromFirebase = false;

    if (firebaseInitialized && db) {
      try {
        const userDocName = userEmail.replace(/@/g, '_').replace(/\./g, '_');
        await db
          .collection('cloudpii')
          .doc(userDocName)
          .collection('files')
          .doc(fileId)
          .delete();
        
        deletedFromFirebase = true;
        console.log(`✅ File ${fileId} deleted from Firebase`);
      } catch (firebaseError) {
        console.error('❌ Firebase delete error:', firebaseError.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to delete from database',
          details: firebaseError.message
        });
      }
    }

    // TODO: Delete physical file from uploads directory

    console.log(`✅ File ${fileId} deleted successfully`);

    res.json({ 
      success: true, 
      message: 'File deleted successfully',
      deletedFrom: deletedFromFirebase ? 'firebase' : 'local'
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

// Test Firebase connection endpoint
app.get('/api/test-firebase', async (req, res) => {
  try {
    if (!firebaseInitialized || !db) {
      return res.json({
        success: false,
        message: 'Firebase not initialized',
        firebase: 'disabled',
        timestamp: new Date().toISOString()
      });
    }

    // Test write operation
    const testRef = db.collection('server_tests').doc('api_test');
    const testData = {
      timestamp: new Date().toISOString(),
      test: true,
      message: 'API connection test',
      randomId: Math.random().toString(36).substr(2, 9)
    };

    await testRef.set(testData);

    // Test read operation
    const testDoc = await testRef.get();

    // Test query operation
    const querySnapshot = await db.collection('server_tests')
      .where('test', '==', true)
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    const recentTests = querySnapshot.docs.map(doc => doc.data());

    res.json({
      success: true,
      message: 'Firebase connection test successful',
      firebase: {
        write: true,
        read: testDoc.exists,
        query: !querySnapshot.empty,
        projectId: process.env.FIREBASE_PROJECT_ID,
        timestamp: new Date().toISOString(),
        recentTests: recentTests.length
      }
    });

  } catch (error) {
    res.json({
      success: false,
      message: 'Firebase connection test failed',
      error: error.message,
      firebase: 'error',
      timestamp: new Date().toISOString()
    });
  }
});

// Get server info
app.get('/api/info', (req, res) => {
  res.json({
    name: 'CloudPii Server',
    version: '1.0.0',
    status: 'running',
    firebase: firebaseInitialized ? 'connected' : 'disabled',
    upload_dir: path.join(__dirname, 'uploads'),
    base_url: process.env.BASE_URL,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? 'connected' : 'disabled',
    environment: process.env.NODE_ENV
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Server error:', error);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server setelah Firebase diinisialisasi
const startServer = async () => {
  try {
    console.log('🚀 Starting CloudPii Server...');
    console.log('📋 Environment:', process.env.NODE_ENV);
    console.log('🔧 Port:', PORT);
    
    // Initialize Firebase first
    await initializeFirebase();
    
    // Then start the server
    app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('🎉 CLOUDPII SERVER STARTED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Base URL: ${process.env.BASE_URL}`);
      console.log(`📁 Upload directory: ${path.join(__dirname, 'uploads')}`);
      console.log(`🔥 Firebase Status: ${firebaseInitialized ? 'CONNECTED ✅' : 'DISABLED ⚠️'}`);
      console.log('='.repeat(60));
      console.log('✅ Endpoints:');
      console.log(`   Health Check: ${process.env.BASE_URL}/health`);
      console.log(`   Upload File: ${process.env.BASE_URL}/api/upload`);
      console.log(`   Test Firebase: ${process.env.BASE_URL}/api/test-firebase`);
      console.log(`   Server Info: ${process.env.BASE_URL}/api/info`);
      console.log('='.repeat(60));
    });
    
  } catch (error) {
    console.error('🚨 CRITICAL: Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();