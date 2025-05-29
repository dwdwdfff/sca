const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT secret key - in production, this should be stored in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-sender-secret-key';

// Authentication middleware
const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user
    const user = User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'المستخدم غير موجود' });
    }
    
    // Add user to request
    req.user = user;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'توكن غير صالح' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'انتهت صلاحية التوكن، يرجى تسجيل الدخول مرة أخرى' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء التحقق من المصادقة' });
  }
};

module.exports = authMiddleware;
