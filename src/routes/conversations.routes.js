const router = require('express').Router();
const { listConversations, createConversation, getConversation } = require('../controllers/conversations.controller');
const { listMessages, sendMessage, deleteMessage }               = require('../controllers/messages.controller');
const { authenticate }  = require('../middleware/auth');
const { uploadMedia }   = require('../config/multer');

router.use(authenticate);

// Conversations
router.get ('/',    listConversations);
router.post('/',    createConversation);
router.get ('/:id', getConversation);

// Messages nested under conversation
router.get   ('/:id/messages',       listMessages);
router.post  ('/:id/messages',       uploadMedia.single('media'), sendMessage);
router.delete('/:id/messages/:messageId', deleteMessage);

module.exports = router;
