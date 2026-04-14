const router = require('express').Router();
const {
  listContacts,
  listPending,
  listSent,
  sendRequest,
  acceptRequest,
  rejectRequest,
  removeContact,
} = require('../controllers/contacts.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Static paths first to avoid collisions with /:id
router.get   ('/',              listContacts);
router.get   ('/pending',       listPending);
router.get   ('/sent',          listSent);
router.post  ('/request',       sendRequest);

// Parameterized paths
router.post  ('/:id/accept',    acceptRequest);
router.post  ('/:id/reject',    rejectRequest);
router.delete('/:contactId',    removeContact);

module.exports = router;
