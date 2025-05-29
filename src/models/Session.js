// Update the session management to link sessions with users
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// In-memory session storage
// In a production environment, this would be stored in a database
const sessions = {};
let nextSessionId = 1;

class Session {
  constructor(id, name, userId) {
    this.id = id;
    this.name = name;
    this.userId = userId; // Link session to user
    this.status = 'INITIALIZING';
    this.socket = null;
    this.qrCode = null;
    this.messagesSent = 0;
    this.queueLength = 0;
    this.messageQueue = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.processingQueue = false;
  }

  // Return session data without sensitive information
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      userId: this.userId,
      status: this.status,
      messagesSent: this.messagesSent,
      queueLength: this.messageQueue.length,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity
    };
  }

  // Initialize WhatsApp session
  async initialize() {
    try {
      this.status = 'INITIALIZING';
      
      // Create sessions directory if it doesn't exist
      const sessionsDir = path.join(__dirname, '../../../sessions');
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }
      
      // Create session directory
      const sessionDir = path.join(sessionsDir, this.id.toString());
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      
      // Create socket
      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false
      });
      
      // Handle connection events
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          // Save QR code
          this.qrCode = qr;
          this.status = 'WAITING_FOR_SCAN';
          console.log(`QR Code for session ${this.id} is ready`);
        }
        
        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            console.log(`Connection closed for session ${this.id}. Reconnecting...`);
            this.status = 'DISCONNECTED';
            await this.initialize();
          } else {
            console.log(`Connection closed for session ${this.id}. Logged out.`);
            this.status = 'LOGGED_OUT';
          }
        } else if (connection === 'open') {
          console.log(`Connection opened for session ${this.id}`);
          this.status = 'CONNECTED';
          this.qrCode = null;
          
          // Start processing message queue
          this.processMessageQueue();
        }
      });
      
      // Save credentials
      this.socket.ev.on('creds.update', saveCreds);
      
      return true;
    } catch (error) {
      console.error(`Error initializing session ${this.id}:`, error);
      this.status = 'ERROR';
      return false;
    }
  }

  // Send message
  async sendMessage(number, message) {
    try {
      if (this.status !== 'CONNECTED') {
        throw new Error('Session not connected');
      }
      
      // Format number
      let formattedNumber = number.trim();
      if (!formattedNumber.includes('@s.whatsapp.net')) {
        // Remove any non-digit characters
        formattedNumber = formattedNumber.replace(/\D/g, '');
        formattedNumber = `${formattedNumber}@s.whatsapp.net`;
      }
      
      // Send message
      await this.socket.sendMessage(formattedNumber, { text: message });
      
      // Update stats
      this.messagesSent++;
      this.lastActivity = new Date();
      
      return true;
    } catch (error) {
      console.error(`Error sending message in session ${this.id}:`, error);
      return false;
    }
  }

  // Add message to queue
  addToQueue(number, message) {
    this.messageQueue.push({ number, message });
    this.queueLength = this.messageQueue.length;
    
    // Start processing queue if not already processing
    if (!this.processingQueue && this.status === 'CONNECTED') {
      this.processMessageQueue();
    }
    
    return this.messageQueue.length;
  }

  // Process message queue
  async processMessageQueue() {
    if (this.processingQueue || this.status !== 'CONNECTED' || this.messageQueue.length === 0) {
      return;
    }
    
    this.processingQueue = true;
    
    try {
      while (this.messageQueue.length > 0 && this.status === 'CONNECTED') {
        const { number, message } = this.messageQueue[0];
        
        // Send message
        const success = await this.sendMessage(number, message);
        
        // Remove from queue
        this.messageQueue.shift();
        this.queueLength = this.messageQueue.length;
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error processing message queue for session ${this.id}:`, error);
    } finally {
      this.processingQueue = false;
    }
  }

  // Disconnect session
  async disconnect() {
    try {
      if (this.socket) {
        this.socket.end();
        this.socket = null;
      }
      this.status = 'DISCONNECTED';
      return true;
    } catch (error) {
      console.error(`Error disconnecting session ${this.id}:`, error);
      return false;
    }
  }

  // Delete session
  async delete() {
    try {
      // Disconnect first
      await this.disconnect();
      
      // Delete session directory
      const sessionDir = path.join(__dirname, '../../../sessions', this.id.toString());
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      
      return true;
    } catch (error) {
      console.error(`Error deleting session ${this.id}:`, error);
      return false;
    }
  }

  // Static methods for session management
  static create(name, userId) {
    const id = nextSessionId++;
    const session = new Session(id, name, userId);
    sessions[id] = session;
    
    // Initialize session
    session.initialize();
    
    return session;
  }

  static getById(id) {
    return sessions[id];
  }

  static getAll() {
    return Object.values(sessions).map(session => session.toJSON());
  }

  static getAllByUserId(userId) {
    return Object.values(sessions)
      .filter(session => session.userId === userId)
      .map(session => session.toJSON());
  }

  static async deleteById(id) {
    const session = sessions[id];
    if (!session) {
      return false;
    }
    
    await session.delete();
    delete sessions[id];
    
    return true;
  }
}

module.exports = Session;
