const express = require('express');
const User = require('../models/User');

const router = express.Router();

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'يرجى تقديم اسم المستخدم والبريد الإلكتروني وكلمة المرور' });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'كلمات المرور غير متطابقة' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
    }
    
    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل' });
    }
    
    // Create user
    const user = User.create({ username, email, password });
    
    // Generate token
    const token = user.generateToken();
    
    // Return user data and token
    res.status(201).json({
      message: 'تم إنشاء الحساب بنجاح',
      user: user.toJSON(),
      token
    });
  } catch (error) {
    if (error.message === 'Username already exists' || error.message === 'Email already exists') {
      return res.status(409).json({ error: error.message });
    }
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الحساب' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    
    // Validate input
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: 'يرجى تقديم اسم المستخدم/البريد الإلكتروني وكلمة المرور' });
    }
    
    // Authenticate user
    const user = User.authenticate(usernameOrEmail, password);
    
    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم/البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }
    
    // Generate token
    const token = user.generateToken();
    
    // Return user data and token
    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user: user.toJSON(),
      token
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// Get current user
router.get('/status', async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح', authenticated: false });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const user = User.verifyToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'توكن غير صالح', authenticated: false });
    }
    
    // Return user data
    res.json({
      authenticated: true,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error getting user status:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء التحقق من حالة المستخدم', authenticated: false });
  }
});

// Logout user
router.post('/logout', async (req, res) => {
  // In a stateless JWT authentication system, the client is responsible for
  // discarding the token. The server cannot invalidate the token.
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

// Get all users (for testing purposes only, would be removed in production)
router.get('/users', async (req, res) => {
  try {
    const users = User.getAll();
    res.json({ users });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب المستخدمين' });
  }
});

module.exports = router;
