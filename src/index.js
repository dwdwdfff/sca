const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');
const xlsx = require('xlsx');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);

// Import routes
const authRoutes = require('./routes/auth');

// Middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));
app.use(express.static(path.join(__dirname, 'public')));

// Mount authentication routes
app.use('/api/auth', authRoutes);

// Store active WhatsApp sessions
const sessions = new Map();

// Create sessions directory if it doesn't exist
const SESSION_DIR = path.join(__dirname, '../sessions');
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Create public directory for web QR display and dashboard
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Create dashboard directory
const DASHBOARD_DIR = path.join(__dirname, 'public/dashboard');
if (!fs.existsSync(DASHBOARD_DIR)) {
  fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
}

// Initialize WhatsApp connection
async function connectToWhatsApp(sessionId) {
  const sessionDir = path.join(SESSION_DIR, sessionId);
  
  // Create session directory if it doesn't exist
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  // Store current QR code
  let qrCode = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      // Save QR code for API access
      qrCode = qr;
      
      // Generate QR code for terminal (for debugging)
      qrcode.generate(qr, { small: true });
      
      // Update session status
      sessions.set(sessionId, {
        ...sessions.get(sessionId),
        qrCode: qr,
        status: 'WAITING_FOR_SCAN'
      });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      sessions.set(sessionId, {
        ...sessions.get(sessionId),
        status: shouldReconnect ? 'DISCONNECTED' : 'LOGGED_OUT'
      });
      
      if (shouldReconnect) {
        connectToWhatsApp(sessionId);
      }
    } else if (connection === 'open') {
      sessions.set(sessionId, {
        ...sessions.get(sessionId),
        status: 'CONNECTED',
        qrCode: null
      });
    }
  });

  sock.ev.on('creds.update', saveCreds);
  
  // Store socket in sessions map
  sessions.set(sessionId, {
    socket: sock,
    qrCode,
    status: 'INITIALIZING',
    name: sessionId,
    createdAt: new Date().toISOString(),
    messagesSent: 0,
    messageQueue: []
  });
  
  return sock;
}

// Get all sessions
app.get('/api/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    name: session.name || id,
    status: session.status,
    createdAt: session.createdAt || new Date().toISOString(),
    messagesSent: session.messagesSent || 0
  }));
  
  res.status(200).json({ sessions: sessionList });
});

// Create new session
app.post('/api/sessions', (req, res) => {
  const { name } = req.body;
  const sessionId = name ? name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() : `session_${Date.now()}`;
  
  if (sessions.has(sessionId)) {
    return res.status(400).json({ error: 'Session with this name already exists' });
  }
  
  connectToWhatsApp(sessionId);
  
  res.status(201).json({ 
    id: sessionId,
    message: `Session ${sessionId} created successfully` 
  });
});

// Delete session
app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  try {
    // Logout if connected
    if (session.status === 'CONNECTED' && session.socket) {
      await session.socket.logout();
    }
    
    // Remove from sessions map
    sessions.delete(sessionId);
    
    // Optionally delete session files
    const sessionDir = path.join(SESSION_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    res.status(200).json({ message: `Session ${sessionId} deleted successfully` });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session', details: error.message });
  }
});

// Get QR code for specific session
app.get('/api/sessions/:sessionId/qr', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.status === 'CONNECTED') {
    return res.status(200).json({ status: 'connected', message: 'Already connected to WhatsApp' });
  }
  
  if (!session.qrCode) {
    return res.status(202).json({ status: 'pending', message: 'QR code not yet generated' });
  }
  
  res.status(200).json({ 
    status: 'success', 
    qrCode: session.qrCode 
  });
});

// Get connection status for specific session
app.get('/api/sessions/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.status(200).json({ 
    status: session.status,
    messagesSent: session.messagesSent || 0,
    queueLength: session.messageQueue ? session.messageQueue.length : 0
  });
});

// Send message via specific session
app.post('/api/sessions/:sessionId/send', async (req, res) => {
  const { sessionId } = req.params;
  const { number, message } = req.body;
  
  if (!number || !message) {
    return res.status(400).json({ error: 'Number and message are required' });
  }
  
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp is not connected' });
  }
  
  try {
    // Format the number (add @s.whatsapp.net)
    const formattedNumber = number.includes('@s.whatsapp.net') 
      ? number 
      : `${number.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    
    // Send message
    await session.socket.sendMessage(formattedNumber, { text: message });
    
    // Update message count
    session.messagesSent = (session.messagesSent || 0) + 1;
    sessions.set(sessionId, session);
    
    res.status(200).json({ status: 'success', message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Parse Excel file and extract phone numbers
app.post('/api/excel/parse', (req, res) => {
  if (!req.files || !req.files.excelFile) {
    return res.status(400).json({ error: 'No Excel file uploaded' });
  }
  
  const excelFile = req.files.excelFile;
  const tempPath = excelFile.tempFilePath;
  
  try {
    // Read Excel file
    const workbook = xlsx.readFile(tempPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    // Extract phone numbers
    const phoneNumbers = [];
    const phoneColumnNames = ['phone', 'phone_number', 'mobile', 'number', 'contact', 'tel', 'telephone'];
    
    data.forEach(row => {
      // Try to find a column that contains phone numbers
      for (const key of Object.keys(row)) {
        const lowerKey = key.toLowerCase();
        if (phoneColumnNames.some(name => lowerKey.includes(name))) {
          const phoneValue = String(row[key]).trim();
          if (phoneValue) {
            phoneNumbers.push(phoneValue);
          }
          break;
        }
      }
      
      // If no specific phone column found, check all columns for values that look like phone numbers
      if (phoneNumbers.length === 0) {
        for (const key of Object.keys(row)) {
          const value = String(row[key]).trim();
          // Simple regex to match potential phone numbers
          if (/^[+\d\s\-()]{7,20}$/.test(value)) {
            phoneNumbers.push(value);
            break;
          }
        }
      }
    });
    
    // Clean up temp file
    fs.unlinkSync(tempPath);
    
    res.status(200).json({ 
      status: 'success', 
      phoneNumbers,
      totalCount: phoneNumbers.length
    });
  } catch (error) {
    console.error('Error parsing Excel file:', error);
    
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    
    res.status(500).json({ error: 'Failed to parse Excel file', details: error.message });
  }
});

// Send bulk messages
app.post('/api/bulk/send', async (req, res) => {
  const { sessionId, numbers, message } = req.body;
  
  if (!sessionId || !numbers || !Array.isArray(numbers) || !message) {
    return res.status(400).json({ error: 'Session ID, numbers array, and message are required' });
  }
  
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp is not connected' });
  }
  
  // Add messages to queue
  const messageQueue = numbers.map(number => ({
    number: number.includes('@s.whatsapp.net') 
      ? number 
      : `${number.replace(/[^0-9]/g, '')}@s.whatsapp.net`,
    message,
    status: 'pending'
  }));
  
  // Store queue in session
  session.messageQueue = [...(session.messageQueue || []), ...messageQueue];
  sessions.set(sessionId, session);
  
  // Start processing queue (non-blocking)
  processMessageQueue(sessionId);
  
  res.status(202).json({ 
    status: 'accepted', 
    message: `Added ${numbers.length} messages to queue`,
    queueId: Date.now().toString()
  });
});

// Process message queue for a session
async function processMessageQueue(sessionId) {
  const session = sessions.get(sessionId);
  
  if (!session || session.status !== 'CONNECTED' || !session.messageQueue || session.messageQueue.length === 0) {
    return;
  }
  
  // Set processing flag
  if (session.isProcessingQueue) {
    return;
  }
  
  session.isProcessingQueue = true;
  sessions.set(sessionId, session);
  
  try {
    // Process messages one by one
    while (session.messageQueue.length > 0) {
      const messageData = session.messageQueue[0];
      
      try {
        await session.socket.sendMessage(messageData.number, { text: messageData.message });
        
        // Update message count
        session.messagesSent = (session.messagesSent || 0) + 1;
        
        // Remove from queue
        session.messageQueue.shift();
        
        // Update session
        sessions.set(sessionId, session);
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error sending message to ${messageData.number}:`, error);
        
        // Mark as failed and move to next
        messageData.status = 'failed';
        messageData.error = error.message;
        session.messageQueue.shift();
        
        // Update session
        sessions.set(sessionId, session);
      }
    }
  } finally {
    // Clear processing flag
    session.isProcessingQueue = false;
    sessions.set(sessionId, session);
  }
}

// Get message queue status for a session
app.get('/api/sessions/:sessionId/queue', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const queueStatus = {
    total: session.messageQueue ? session.messageQueue.length : 0,
    processing: session.isProcessingQueue || false,
    sent: session.messagesSent || 0
  };
  
  res.status(200).json(queueStatus);
});

// Create HTML for QR display
const generateQrHtml = (sessionId) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp QR Code</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        background-color: #f0f2f5;
      }
      .container {
        text-align: center;
        background-color: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        max-width: 90%;
      }
      h1 {
        color: #128C7E;
      }
      #qrcode {
        margin: 20px auto;
        width: 256px;
        height: 256px;
      }
      #status {
        margin: 20px 0;
        font-weight: bold;
      }
      .loading {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 3px solid rgba(0, 0, 0, 0.3);
        border-radius: 50%;
        border-top-color: #128C7E;
        animation: spin 1s ease-in-out infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>WhatsApp QR Code</h1>
      <p>Scan this QR code with WhatsApp on your phone to log in</p>
      <div id="qrcode"></div>
      <div id="status">Loading QR code... <span class="loading"></span></div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.0/build/qrcode.min.js"></script>
    <script>
      const sessionId = '${sessionId}';
      const qrElement = document.getElementById('qrcode');
      const statusElement = document.getElementById('status');
      
      async function fetchQR() {
        try {
          const response = await fetch(\`/api/sessions/\${sessionId}/qr\`);
          const data = await response.json();
          
          if (data.status === 'connected') {
            statusElement.innerHTML = 'Connected to WhatsApp!';
            return;
          }
          
          if (data.status === 'pending') {
            statusElement.innerHTML = 'Waiting for QR code... <span class="loading"></span>';
            setTimeout(fetchQR, 1000);
            return;
          }
          
          if (data.qrCode) {
            // Generate QR code
            QRCode.toCanvas(qrElement, data.qrCode, { width: 256 }, (error) => {
              if (error) console.error(error);
            });
            statusElement.innerHTML = 'Scan with WhatsApp to connect';
          }
        } catch (error) {
          console.error('Error fetching QR code:', error);
          statusElement.innerHTML = 'Error loading QR code. Please refresh.';
        }
      }
      
      // Check status periodically
      async function checkStatus() {
        try {
          const response = await fetch(\`/api/sessions/\${sessionId}/status\`);
          const data = await response.json();
          
          if (data.status === 'CONNECTED') {
            statusElement.innerHTML = 'Connected to WhatsApp!';
            return;
          }
          
          setTimeout(checkStatus, 2000);
        } catch (error) {
          console.error('Error checking status:', error);
        }
      }
      
      // Initial fetch
      fetchQR();
      checkStatus();
    </script>
  </body>
  </html>
  `;
};

// Serve QR code page
app.get('/qr/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessions.has(sessionId)) {
    return res.status(404).send('Session not found');
  }
  
  res.send(generateQrHtml(sessionId));
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dashboard/index.html'));
});

// Start server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
