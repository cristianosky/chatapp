const router = require('express').Router();
const { registerKey, getConversationKeys } = require('../controllers/keys.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.put('/me', registerKey);
router.get('/conversation/:conversationId', getConversationKeys);

module.exports = router;
