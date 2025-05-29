const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// In a production environment, this would be stored in a database
// For this demo, we'll use an in-memory array
const users = [];
let nextId = 1;

// JWT secret key - in production, this should be stored in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-sender-secret-key';

class User {
  constructor(username, email, password) {
    this.id = nextId++;
    this.username = username;
    this.email = email;
    this.password = bcrypt.hashSync(password, 10); // Hash the password
    this.createdAt = new Date();
    this.lastLogin = null;
  }

  // Generate JWT token for authentication
  generateToken() {
    return jwt.sign(
      { 
        id: this.id, 
        username: this.username, 
        email: this.email 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' } // Token expires in 7 days
    );
  }

  // Return user data without sensitive information
  toJSON() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      createdAt: this.createdAt,
      lastLogin: this.lastLogin
    };
  }

  // Static methods for user management
  static create(userData) {
    const { username, email, password } = userData;
    
    // Check if username or email already exists
    if (User.findByUsername(username)) {
      throw new Error('Username already exists');
    }
    
    if (User.findByEmail(email)) {
      throw new Error('Email already exists');
    }
    
    const user = new User(username, email, password);
    users.push(user);
    return user;
  }

  static findById(id) {
    return users.find(user => user.id === parseInt(id));
  }

  static findByUsername(username) {
    return users.find(user => user.username === username);
  }

  static findByEmail(email) {
    return users.find(user => user.email === email);
  }

  static authenticate(usernameOrEmail, password) {
    // Find user by username or email
    const user = User.findByUsername(usernameOrEmail) || User.findByEmail(usernameOrEmail);
    
    if (!user) {
      return null;
    }
    
    // Check password
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    
    if (!isPasswordValid) {
      return null;
    }
    
    // Update last login time
    user.lastLogin = new Date();
    
    return user;
  }

  static getAll() {
    return users.map(user => user.toJSON());
  }

  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return User.findById(decoded.id);
    } catch (error) {
      return null;
    }
  }
}

module.exports = User;
