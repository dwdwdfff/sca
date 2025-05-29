const express = require('express');
const authMiddleware = require('../middleware/auth');
const Session = require('../models/Session');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Get all sessions for the authenticated user
router.get('/', async (req, res) => {
  try {
    const sessions = Session.getAllByUserId(req.user.id);
    res.json({ sessions });
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب الجلسات' });
  }
});

// Create a new session
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'يرجى تقديم اسم للجلسة' });
    }
    
    const session = Session.create(name, req.user.id);
    
    res.status(201).json(session.toJSON());
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الجلسة' });
  }
});

// Get session by ID
router.get('/:id', async (req, res) => {
  try {
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الجلسة' });
    }
    
    res.json(session.toJSON());
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب الجلسة' });
  }
});

// Delete session by ID
router.delete('/:id', async (req, res) => {
  try {
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بحذف هذه الجلسة' });
    }
    
    await Session.deleteById(req.params.id);
    
    res.json({ message: 'تم حذف الجلسة بنجاح' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء حذف الجلسة' });
  }
});

// Get session status
router.get('/:id/status', async (req, res) => {
  try {
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الجلسة' });
    }
    
    res.json({
      id: session.id,
      status: session.status,
      messagesSent: session.messagesSent,
      queueLength: session.messageQueue.length
    });
  } catch (error) {
    console.error('Error getting session status:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب حالة الجلسة' });
  }
});

// Get QR code for session
router.get('/:id/qr', async (req, res) => {
  try {
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الجلسة' });
    }
    
    if (session.status === 'CONNECTED') {
      return res.json({ status: 'connected', message: 'الجلسة متصلة بالفعل' });
    }
    
    if (!session.qrCode) {
      return res.json({ status: 'pending', message: 'جاري إنشاء رمز QR' });
    }
    
    res.json({ qrCode: session.qrCode });
  } catch (error) {
    console.error('Error getting QR code:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب رمز QR' });
  }
});

// Send message
router.post('/:id/send', async (req, res) => {
  try {
    const { number, message } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({ error: 'يرجى تقديم رقم الهاتف والرسالة' });
    }
    
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الجلسة' });
    }
    
    if (session.status !== 'CONNECTED') {
      return res.status(400).json({ error: 'الجلسة غير متصلة' });
    }
    
    const success = await session.sendMessage(number, message);
    
    if (!success) {
      return res.status(500).json({ error: 'فشل في إرسال الرسالة' });
    }
    
    res.json({ message: 'تم إرسال الرسالة بنجاح' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة' });
  }
});

// Send bulk messages
router.post('/:id/bulk', async (req, res) => {
  try {
    const { numbers, message } = req.body;
    
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !message) {
      return res.status(400).json({ error: 'يرجى تقديم قائمة أرقام الهواتف والرسالة' });
    }
    
    const session = Session.getById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }
    
    // Check if session belongs to the authenticated user
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الجلسة' });
    }
    
    if (session.status !== 'CONNECTED') {
      return res.status(400).json({ error: 'الجلسة غير متصلة' });
    }
    
    // Add messages to queue
    for (const number of numbers) {
      session.addToQueue(number, message);
    }
    
    res.json({ 
      message: `تم إضافة ${numbers.length} رسالة إلى قائمة الانتظار`,
      queueLength: session.messageQueue.length
    });
  } catch (error) {
    console.error('Error sending bulk messages:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسائل' });
  }
});

module.exports = router;
